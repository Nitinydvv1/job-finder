import React, { useState, useEffect, Component } from "react";
import { auth, db } from "./lib/firebase";
import { FirebaseError } from "firebase/app";
import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import {
  collection,
  query,
  getDocs,
  addDoc,
  where,
  orderBy,
  limit,
  onSnapshot,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { Toaster, toast } from "sonner";
import {
  FileText,
  Upload,
  Search,
  Briefcase,
  CheckCircle2,
  Loader2,
  LogOut,
  User as UserIcon,
  Sparkles,
  AlertCircle,
  TrendingUp,
  Heart,
  Bookmark,
} from "lucide-react";
import { useDropzone, FileRejection } from "react-dropzone";
import axios, { AxiosError } from "axios";
import { Resume, Job, MatchResult, Application } from "./types";
import {
  parseResume,
  rankJobs,
  generateCoverLetter,
  reviewResume,
  getEmbedding,
  cosineSimilarity,
  fetchLatestJobs,
} from "./lib/gemini";
import { handleFirestoreError, OperationType } from "./lib/firestore-errors";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

interface LoginDebugInfo {
  phase: "auth" | "profile";
  code: string;
  message: string;
  timestamp: string;
  origin: string;
}

const getAuthErrorMessage = (error: unknown): string => {
  if (!(error instanceof FirebaseError)) {
    return "Login failed. Please try again.";
  }

  switch (error.code) {
    case "auth/popup-closed-by-user":
      return "Login popup was closed before completing sign-in.";
    case "auth/popup-blocked":
      return "Popup was blocked by your browser. Allow popups and try again.";
    case "auth/cancelled-popup-request":
      return "Another login request is in progress. Please try again.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Auth. Add localhost to Authorized domains.";
    case "auth/operation-not-allowed":
      return "Google sign-in is not enabled in Firebase Authentication.";
    default:
      return `Login failed (${error.code}).`;
  }
};

const getResumeProcessingErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const apiError = error as AxiosError<{ error?: string }>;
    const serverMessage = apiError.response?.data?.error;
    if (serverMessage) {
      return serverMessage;
    }
    return "Failed to upload resume. Please try again.";
  }

  if (error instanceof FirebaseError) {
    if (error.code === "auth/unauthenticated") {
      return "Please log in again and retry uploading your resume.";
    }
    if (error.code === "permission-denied") {
      return "You do not have permission to save this resume in Firestore.";
    }
    return `Resume processing failed (${error.code}).`;
  }

  if (error instanceof Error) {
    if (error.message.includes("GEMINI_API_KEY")) {
      return "Gemini API key is missing. Add GEMINI_API_KEY in .env.local and restart the dev server.";
    }
    return error.message;
  }

  return "Resume processing failed. Please try again.";
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const errInfo = JSON.parse(this.state.error.message);
        if (errInfo.error.includes("Missing or insufficient permissions")) {
          message =
            "You don't have permission to perform this action. Please make sure you are logged in with the correct account.";
        }
      } catch (e) {
        message = this.state.error.message || message;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
          <div className="max-w-md w-full bg-white p-8 rounded-[32px] border border-zinc-200 shadow-xl text-center">
            <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-6" />
            <h2 className="text-2xl font-black tracking-tight text-zinc-900 mb-2">
              Application Error
            </h2>
            <p className="text-zinc-500 font-medium mb-8 leading-relaxed">
              {message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all active:scale-95"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [fetchingJobs, setFetchingJobs] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [currentResume, setCurrentResume] = useState<Resume | null>(null);
  const [coverLetters, setCoverLetters] = useState<Record<string, string>>({});
  const [generatingCoverLetter, setGeneratingCoverLetter] = useState<
    string | null
  >(null);
  const [resumeReview, setResumeReview] = useState<{
    mistakes: string[];
    improvements: string[];
  } | null>(null);
  const [locationFilter, setLocationFilter] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [savedJobIds, setSavedJobIds] = useState<string[]>([]);
  const [applyingJob, setApplyingJob] = useState<Job | null>(null);
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [applications, setApplications] = useState<Application[]>([]);
  const [view, setView] = useState<"jobs" | "applications">("jobs");
  const [loginDebugInfo, setLoginDebugInfo] = useState<LoginDebugInfo | null>(
    null,
  );
  const isDevMode =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const currentHost =
    typeof window !== "undefined" ? window.location.hostname : "unknown";
  const currentOrigin =
    typeof window !== "undefined" ? window.location.origin : "unknown";
  const showUnauthorizedDomainHelp =
    loginDebugInfo?.code === "auth/unauthorized-domain";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user || !currentResume) return;

    // Listen for new jobs added after the current time
    const startTime = new Date().toISOString();
    const q = query(
      collection(db, "jobs"),
      where("createdAt", ">", startTime),
      orderBy("createdAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === "added") {
            const newJob = { id: change.doc.id, ...change.doc.data() } as Job;

            // Calculate similarity with current resume
            let jobEmbedding = newJob.embedding;
            if (!jobEmbedding || jobEmbedding.length === 0) {
              const jobText = `${newJob.title} ${newJob.description} ${newJob.requirements?.join(", ")}`;
              try {
                jobEmbedding = await getEmbedding(jobText);
              } catch (e) {
                console.error("Failed to get embedding for notification", e);
                return;
              }
            }

            const similarity = cosineSimilarity(
              currentResume.embedding,
              jobEmbedding,
            );
            const score = Math.max(
              0,
              Math.min(100, Math.round(similarity * 100)),
            );

            // If it's a good match (e.g., > 70%), notify the user
            if (score >= 70) {
              toast.info(`New Match: ${newJob.title} at ${newJob.company}`, {
                description: `We found a new job that matches your profile with a ${score}% score!`,
                duration: 10000,
                action: {
                  label: "View",
                  onClick: () => {
                    // Scroll to top or highlight the job if possible
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  },
                },
              });

              // Refresh matches list
              performMatching(currentResume);
            }
          }
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "jobs");
      },
    );

    return () => unsubscribe();
  }, [user, currentResume]);

  useEffect(() => {
    if (!user) {
      setSavedJobIds([]);
      return;
    }

    const q = query(
      collection(db, "saved_jobs"),
      where("userId", "==", user.uid),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const ids = snapshot.docs.map((doc) => doc.data().jobId);
        setSavedJobIds(ids);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "saved_jobs");
      },
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) {
      setApplications([]);
      return;
    }

    const q = query(
      collection(db, "applications"),
      where("userId", "==", user.uid),
      orderBy("appliedAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const apps = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Application,
        );
        setApplications(apps);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "applications");
      },
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (loading || !user) return;

    const seedJobs = async () => {
      try {
        const jobsSnap = await getDocs(collection(db, "jobs"));
        if (jobsSnap.empty) {
          const sampleJobs = [
            {
              title: "Senior Frontend Engineer",
              company: "TechFlow India",
              location: "Bangalore, India",
              description:
                "We are looking for a React expert to lead our frontend team. Experience with TypeScript, Tailwind, and modern state management is required.",
              requirements: ["React", "TypeScript", "Tailwind", "Next.js"],
              sourceUrl: "https://www.linkedin.com/jobs",
              createdAt: new Date().toISOString(),
            },
            {
              title: "Full Stack Developer",
              company: "Innovation Hub",
              location: "Mumbai, India",
              description:
                "Join our fast-growing startup to build scalable web applications. Proficiency in Node.js, React, and PostgreSQL is a must.",
              requirements: ["Node.js", "React", "PostgreSQL", "Express"],
              sourceUrl: "https://www.naukri.com",
              createdAt: new Date().toISOString(),
            },
            {
              title: "Product Designer",
              company: "Creative Studio",
              location: "Delhi, India",
              description:
                "Looking for a UI/UX designer with a strong portfolio in mobile and web apps. Experience with Figma and user research is preferred.",
              requirements: ["Figma", "UI/UX", "Prototyping"],
              sourceUrl: "https://www.behance.net/joblist",
              createdAt: new Date().toISOString(),
            },
            {
              title: "Backend Engineer (Go)",
              company: "DataScale",
              location: "Gurgaon, India",
              description:
                "Help us build high-performance distributed systems using Go. Experience with Kubernetes and cloud infrastructure is required.",
              requirements: ["Go", "Kubernetes", "PostgreSQL", "Docker"],
              sourceUrl: "https://wellfound.com/jobs",
              createdAt: new Date().toISOString(),
            },
            {
              title: "AI/ML Engineer",
              company: "Future AI",
              location: "Hyderabad, India",
              description:
                "Work on cutting-edge AI models and integrate them into our core products. Experience with Python and PyTorch is a must.",
              requirements: ["Python", "PyTorch", "NLP", "Machine Learning"],
              sourceUrl: "https://www.glassdoor.co.in",
              createdAt: new Date().toISOString(),
            },
          ];

          // Only admins can seed
          const isAdmin = user.email === "nitinyadav66829@gmail.com";
          if (isAdmin) {
            for (const job of sampleJobs) {
              await addDoc(collection(db, "jobs"), job);
            }
            toast.success("Indian jobs seeded!");
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, "jobs");
      }
    };
    seedJobs();
  }, [loading, user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    setLoginDebugInfo(null);

    try {
      const result = await signInWithPopup(auth, provider);
      toast.success("Logged in successfully");

      // Ensure user document exists
      const userRef = doc(db, "users", result.user.uid);
      try {
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          await setDoc(userRef, {
            email: result.user.email,
            role: "user",
            createdAt: new Date().toISOString(),
          });
        }
      } catch (profileError) {
        console.error("User profile creation failed:", profileError);

        const debugInfo: LoginDebugInfo =
          profileError instanceof FirebaseError
            ? {
                phase: "profile",
                code: profileError.code,
                message: profileError.message,
                timestamp: new Date().toISOString(),
                origin: window.location.origin,
              }
            : {
                phase: "profile",
                code: "unknown-profile-error",
                message:
                  profileError instanceof Error
                    ? profileError.message
                    : String(profileError),
                timestamp: new Date().toISOString(),
                origin: window.location.origin,
              };

        setLoginDebugInfo(debugInfo);
        toast.warning(
          "Logged in, but failed to create your profile document in Firestore.",
        );
      }
    } catch (error) {
      console.error(error);

      const debugInfo: LoginDebugInfo =
        error instanceof FirebaseError
          ? {
              phase: "auth",
              code: error.code,
              message: error.message,
              timestamp: new Date().toISOString(),
              origin: window.location.origin,
            }
          : {
              phase: "auth",
              code: "unknown-auth-error",
              message: error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString(),
              origin: window.location.origin,
            };

      setLoginDebugInfo(debugInfo);
      toast.error(getAuthErrorMessage(error));
    }
  };

  const handleLogout = () => auth.signOut();

  const handleGenerateCoverLetter = async (job: Job) => {
    if (!currentResume) return;
    setGeneratingCoverLetter(job.id);
    try {
      const letter = await generateCoverLetter(currentResume.parsedJson, job);
      setCoverLetters((prev) => ({ ...prev, [job.id]: letter }));
      toast.success("Cover letter generated!");
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate cover letter");
    } finally {
      setGeneratingCoverLetter(null);
    }
  };

  const onDrop = async (acceptedFiles: File[]): Promise<void> => {
    if (!user) {
      toast.error("Please login first");
      return;
    }
    const file = acceptedFiles[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("resume", file);

    try {
      const response = await axios.post("/api/upload-resume", formData);
      const { fileName, text } = response.data;

      setProcessing(true);

      // Parse resume first so review can use the extracted structure
      const parsedJson = await parseResume(text);
      const [review, resumeEmbedding] = await Promise.all([
        reviewResume(text, parsedJson),
        getEmbedding(text),
      ]);

      setResumeReview(review);

      // Save to Firestore
      const resumeData = {
        userId: user.uid,
        fileName: fileName || file.name || "resume.pdf",
        parsedJson,
        embedding: resumeEmbedding,
        createdAt: new Date().toISOString(),
      };

      const resumeRef = await addDoc(collection(db, "resumes"), resumeData);

      const newResume = {
        id: resumeRef.id,
        ...resumeData,
      };
      setCurrentResume(newResume);

      // Perform matching
      await performMatching(newResume);
      toast.success("Resume processed and matched!");
    } catch (error) {
      console.error("Resume upload/process error:", error);
      toast.error(getResumeProcessingErrorMessage(error));
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const handleFetchRealtimeJobs = async () => {
    setFetchingJobs(true);
    try {
      const latestJobs = await fetchLatestJobs();

      // Save these jobs to Firestore
      const savedJobs = await Promise.all(
        latestJobs.map(async (job) => {
          const jobText = `${job.title} ${job.company} ${job.description} ${job.requirements.join(", ")}`;
          const embedding = await getEmbedding(jobText);

          const jobData = {
            ...job,
            embedding,
            createdAt: new Date().toISOString(),
          };

          try {
            const docRef = await addDoc(collection(db, "jobs"), jobData);
            return { id: docRef.id, ...jobData } as Job;
          } catch (e) {
            handleFirestoreError(e, OperationType.WRITE, "jobs");
          }
        }),
      );

      toast.success(`Fetched ${savedJobs.length} latest jobs from India!`);

      // If we have a resume, re-match
      if (currentResume) {
        await performMatching(currentResume);
      } else {
        // Just update matches with 0 score for display
        setMatches(savedJobs.map((j) => ({ job: j, score: 0 })));
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to fetch latest jobs");
    } finally {
      setFetchingJobs(false);
    }
  };

  const performMatching = async (resume: Resume) => {
    try {
      const jobsSnap = await getDocs(collection(db, "jobs"));
      const jobs = jobsSnap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as Job,
      );

      if (!resume.embedding || resume.embedding.length === 0) {
        toast.error("Resume embedding missing");
        return;
      }

      // Perform hybrid matching
      const rankedResults = await Promise.all(
        jobs.map(async (job) => {
          // 1. Semantic Similarity (60% weight)
          let jobEmbedding = (job as any).embedding;
          if (!jobEmbedding || jobEmbedding.length === 0) {
            const jobText = `${job.title} ${job.description} ${job.requirements?.join(", ")}`;
            jobEmbedding = await getEmbedding(jobText);
          }
          const semanticSimilarity = cosineSimilarity(
            resume.embedding,
            jobEmbedding,
          );
          const semanticScore = Math.max(
            0,
            Math.min(100, semanticSimilarity * 100),
          );

          // 2. Keyword Matching (40% weight)
          let keywordScore = 0;
          if (job.requirements && job.requirements.length > 0) {
            const resumeSkills = resume.parsedJson.skills.map((s) =>
              s.toLowerCase(),
            );
            const matchedKeywords = job.requirements.filter((req) =>
              resumeSkills.some(
                (skill) =>
                  skill.includes(req.toLowerCase()) ||
                  req.toLowerCase().includes(skill),
              ),
            );
            keywordScore =
              (matchedKeywords.length / job.requirements.length) * 100;
          } else {
            // If no requirements listed, rely more on semantic score
            keywordScore = semanticScore;
          }

          // 3. Weighted Final Score
          const finalScore = Math.round(
            semanticScore * 0.6 + keywordScore * 0.4,
          );

          return {
            job,
            score: finalScore,
          };
        }),
      );

      setMatches(rankedResults.sort((a: any, b: any) => b.score - a.score));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, "jobs");
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files: File[]) => {
      onDrop(files);
    },
    onDropRejected: (fileRejections: FileRejection[]) => {
      const firstError = fileRejections[0]?.errors[0];
      if (!firstError) {
        toast.error("Invalid file. Please upload a PDF resume.");
        return;
      }

      if (firstError.code === "file-invalid-type") {
        toast.error("Only PDF files are supported. Please upload a .pdf file.");
        return;
      }

      if (firstError.code === "file-too-large") {
        toast.error("File is too large. Please upload a smaller PDF.");
        return;
      }

      toast.error(firstError.message || "Could not accept this file.");
    },
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
    maxSize: 10 * 1024 * 1024,
  } as any);

  const filteredMatches = matches.filter((match) => {
    const matchesLocation = match.job.location
      .toLowerCase()
      .includes(locationFilter.toLowerCase());
    const matchesSkills =
      selectedSkills.length === 0 ||
      selectedSkills.some(
        (skill) =>
          match.job.requirements?.some(
            (req) =>
              req.toLowerCase().includes(skill.toLowerCase()) ||
              skill.toLowerCase().includes(req.toLowerCase()),
          ) ||
          match.job.description.toLowerCase().includes(skill.toLowerCase()),
      );
    return matchesLocation && matchesSkills;
  });

  const resumeMistakes = resumeReview?.mistakes ?? [];
  const resumeImprovements = resumeReview?.improvements ?? [];
  const reviewScore = Math.max(
    0,
    Math.min(
      100,
      75 - resumeMistakes.length * 10 + resumeImprovements.length * 4,
    ),
  );
  const activeFilterCount =
    selectedSkills.length + (locationFilter.trim() ? 1 : 0);
  const averageMatchScore =
    filteredMatches.length > 0
      ? Math.round(
          filteredMatches.reduce((sum, match) => sum + match.score, 0) /
            filteredMatches.length,
        )
      : 0;
  const reviewLevel =
    reviewScore >= 85
      ? "Strong"
      : reviewScore >= 70
        ? "Good"
        : reviewScore >= 55
          ? "Needs Work"
          : "Critical";
  const topPriorities = [
    ...resumeMistakes
      .slice(0, 2)
      .map((item) => ({ kind: "mistake", text: item })),
    ...resumeImprovements
      .slice(0, 1)
      .map((item) => ({ kind: "improvement", text: item })),
  ];

  const toggleSkill = (skill: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill],
    );
  };

  const handleToggleSaveJob = async (jobId: string) => {
    if (!user) {
      toast.error("Please login to save jobs");
      return;
    }

    try {
      const isSaved = savedJobIds.includes(jobId);
      if (isSaved) {
        // Find the doc to delete
        const q = query(
          collection(db, "saved_jobs"),
          where("userId", "==", user.uid),
          where("jobId", "==", jobId),
        );
        const snap = await getDocs(q);
        snap.forEach(async (d) => {
          try {
            await deleteDoc(doc(db, "saved_jobs", d.id));
          } catch (e) {
            handleFirestoreError(e, OperationType.DELETE, `saved_jobs/${d.id}`);
          }
        });
        toast.success("Job removed from saved");
      } else {
        await addDoc(collection(db, "saved_jobs"), {
          userId: user.uid,
          jobId,
          savedAt: new Date().toISOString(),
        });
        toast.success("Job saved!");
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "saved_jobs");
    }
  };

  const handleApply = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !applyingJob || !currentResume) return;

    setSubmittingApplication(true);
    try {
      const formData = new FormData(e.currentTarget);
      const coverLetter = formData.get("coverLetter") as string;
      const notes = formData.get("notes") as string;

      await addDoc(collection(db, "applications"), {
        userId: user.uid,
        jobId: applyingJob.id,
        resumeId: currentResume.id,
        status: "pending",
        appliedAt: new Date().toISOString(),
        coverLetter,
        notes,
      });

      toast.success("Application submitted successfully!");
      setApplyingJob(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "applications");
    } finally {
      setSubmittingApplication(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-zinc-50">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F5F5F5] text-zinc-900 font-sans selection:bg-zinc-900 selection:text-white">
        <Toaster position="top-center" richColors />

        {showUnauthorizedDomainHelp ? (
          <div className="mx-auto mt-4 w-[min(96vw,980px)] rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 shadow-sm">
            <p className="text-sm font-extrabold uppercase tracking-wide text-rose-700">
              Firebase Login Setup Required
            </p>
            <p className="mt-1 text-sm font-medium text-rose-900 break-words">
              Add this domain in Firebase Authentication Authorized domains:{" "}
              <span className="font-mono">{currentHost}</span>
            </p>
            <p className="mt-1 text-xs font-mono text-rose-800 break-all">
              Current origin: {currentOrigin}
            </p>
            <p className="mt-2 text-xs text-rose-900">
              Firebase Console: Authentication &gt; Settings &gt; Authorized
              domains. Then hard refresh this page and try Sign In again.
            </p>
          </div>
        ) : null}

        {isDevMode && loginDebugInfo ? (
          <div className="fixed bottom-4 right-4 z-[100] w-[min(92vw,430px)] rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-lg shadow-amber-200/60">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wider text-amber-700">
                  Login Debug
                </p>
                <p className="text-sm font-semibold text-amber-900">
                  Phase: {loginDebugInfo.phase}
                </p>
              </div>
              <button
                onClick={() => setLoginDebugInfo(null)}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
              >
                Dismiss
              </button>
            </div>
            <p className="text-xs font-mono text-amber-800">
              code: {loginDebugInfo.code}
            </p>
            <p className="mt-1 text-xs font-mono text-amber-800 break-all">
              origin: {loginDebugInfo.origin}
            </p>
            <p className="mt-1 text-xs text-amber-900 break-words">
              {loginDebugInfo.message}
            </p>
            <p className="mt-2 text-[10px] font-mono text-amber-700">
              {loginDebugInfo.timestamp}
            </p>
          </div>
        ) : null}

        {/* Navigation */}
        <nav className="sticky top-0 z-50 w-full border-b border-zinc-200 bg-white/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shadow-lg shadow-zinc-200">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight">
                MatchAI{" "}
                <span className="text-zinc-400 font-medium text-sm ml-1">
                  India
                </span>
              </span>
            </div>

            <div className="flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-4">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-sm font-semibold">
                      {user.displayName}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                      {user.email}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-500 hover:text-zinc-900"
                    title="Logout"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleLogin}
                  className="bg-zinc-900 text-white px-5 py-2 rounded-full text-sm font-medium hover:bg-zinc-800 transition-all shadow-md shadow-zinc-200 active:scale-95"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {!user ? (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 text-zinc-500 text-xs font-bold uppercase tracking-widest mb-8">
                  <TrendingUp className="w-3 h-3" />
                  AI-Powered Career Matching
                </div>
                <h1 className="text-6xl sm:text-7xl font-black tracking-tighter mb-8 leading-[0.9] text-zinc-900">
                  Find your next{" "}
                  <span className="text-zinc-400 italic">dream</span> role in
                  India.
                </h1>
                <p className="text-xl text-zinc-500 mb-12 max-w-xl mx-auto leading-relaxed">
                  Upload your resume and let our AI analyze your experience to
                  find the best career opportunities tailored for you.
                </p>
                <button
                  onClick={handleLogin}
                  className="h-16 px-10 text-lg font-bold rounded-full bg-zinc-900 text-white hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 active:scale-95 flex items-center gap-3 mx-auto"
                >
                  Get Started for Free
                  <CheckCircle2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
              {/* Left Column: Upload & Profile */}
              <div className="lg:col-span-4 space-y-8">
                <div className="bg-white border border-zinc-200 rounded-[24px] shadow-sm overflow-hidden">
                  <div className="p-6 bg-zinc-50/50 border-b border-zinc-100">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                      <Upload className="w-4 h-4" />
                      Upload Resume
                    </h3>
                  </div>
                  <div className="p-8">
                    <div
                      {...getRootProps()}
                      className={`
                        border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
                        ${isDragActive ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:border-zinc-400"}
                        ${uploading || processing ? "pointer-events-none opacity-50" : ""}
                      `}
                    >
                      <input {...getInputProps()} />
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center shadow-inner">
                          {uploading || processing ? (
                            <Loader2 className="w-7 h-7 animate-spin text-zinc-600" />
                          ) : (
                            <FileText className="w-7 h-7 text-zinc-600" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="font-bold text-zinc-900">
                            {uploading
                              ? "Uploading..."
                              : processing
                                ? "Analyzing..."
                                : "Drop your PDF here"}
                          </p>
                          <p className="text-xs text-zinc-400 font-medium">
                            PDF only, max 10MB
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-3 gap-2">
                      <div
                        className={`rounded-xl border px-3 py-2 text-center ${uploading || processing || currentResume ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-widest">
                          1
                        </p>
                        <p className="text-[10px] font-semibold mt-1">Upload</p>
                      </div>
                      <div
                        className={`rounded-xl border px-3 py-2 text-center ${processing || currentResume ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-widest">
                          2
                        </p>
                        <p className="text-[10px] font-semibold mt-1">
                          Analyze
                        </p>
                      </div>
                      <div
                        className={`rounded-xl border px-3 py-2 text-center ${currentResume ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-widest">
                          3
                        </p>
                        <p className="text-[10px] font-semibold mt-1">Match</p>
                      </div>
                    </div>

                    {(uploading || processing) && (
                      <div className="mt-8 space-y-3">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                          <span>
                            {uploading ? "Uploading file..." : "AI Analysis..."}
                          </span>
                          <span>{processing ? "85%" : "40%"}</span>
                        </div>
                        <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-zinc-900 transition-all duration-1000 ease-out"
                            style={{ width: processing ? "85%" : "40%" }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {currentResume && (
                  <div className="bg-white border border-zinc-200 rounded-[24px] shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                        <UserIcon className="w-4 h-4" />
                        Parsed Profile
                      </h3>
                      <p className="text-xs text-zinc-500 mt-2 font-medium">
                        {currentResume.parsedJson.skills.length} skills detected
                        from your latest resume.
                      </p>
                    </div>
                    <div className="p-8 space-y-8">
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-4">
                          Top Skills
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {currentResume.parsedJson.skills.map((skill, i) => (
                            <span
                              key={i}
                              className="px-3 py-1 bg-zinc-100 text-zinc-900 rounded-full text-xs font-bold border border-zinc-200/50"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-4">
                          Summary
                        </h4>
                        <p className="text-sm text-zinc-600 leading-relaxed font-medium">
                          {currentResume.parsedJson.summary}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {resumeReview && (
                  <div className="bg-white border border-zinc-200 rounded-[24px] shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-zinc-100 bg-amber-50/30 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-amber-600 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Resume Review
                      </h3>
                      <span
                        className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${reviewScore >= 85 ? "bg-emerald-100 text-emerald-700" : reviewScore >= 70 ? "bg-zinc-100 text-zinc-700" : reviewScore >= 55 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}
                      >
                        {reviewLevel}
                      </span>
                    </div>
                    <div className="p-8 space-y-8">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-4 text-center">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                            Review Score
                          </p>
                          <p className="text-2xl font-black tracking-tight text-zinc-900 mt-1">
                            {reviewScore}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-4 text-center">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
                            Mistakes
                          </p>
                          <p className="text-2xl font-black tracking-tight text-amber-700 mt-1">
                            {resumeMistakes.length}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-4 text-center">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                            Improvements
                          </p>
                          <p className="text-2xl font-black tracking-tight text-emerald-700 mt-1">
                            {resumeImprovements.length}
                          </p>
                        </div>
                      </div>

                      {topPriorities.length > 0 && (
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-4">
                          <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">
                            Focus Next
                          </h4>
                          <ul className="space-y-2">
                            {topPriorities.map((item, index) => (
                              <li
                                key={index}
                                className="text-xs font-semibold text-zinc-700 flex items-start gap-2"
                              >
                                <span
                                  className={`mt-1 inline-block h-2 w-2 rounded-full ${item.kind === "mistake" ? "bg-amber-500" : "bg-emerald-500"}`}
                                />
                                <span>{item.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-4 flex items-center gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                          Mistakes in Resume
                        </h4>
                        <ul className="space-y-3">
                          {resumeMistakes.length === 0 ? (
                            <li className="text-sm text-zinc-500 font-medium rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                              No major mistakes detected in this upload.
                            </li>
                          ) : (
                            resumeMistakes.map((mistake, i) => (
                              <li
                                key={i}
                                className="text-sm text-zinc-700 flex items-start gap-3 font-medium rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3"
                              >
                                <span className="min-w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-extrabold flex items-center justify-center mt-0.5">
                                  {i + 1}
                                </span>
                                <span>{mistake}</span>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>

                      <div className="pt-6 border-t border-zinc-100">
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-4 flex items-center gap-2">
                          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                          Resume Improvements
                        </h4>
                        <ul className="space-y-3">
                          {resumeImprovements.length === 0 ? (
                            <li className="text-sm text-zinc-500 font-medium rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                              No specific improvements suggested for this
                              upload.
                            </li>
                          ) : (
                            resumeImprovements.map((improvement, i) => (
                              <li
                                key={i}
                                className="text-sm text-zinc-700 flex items-start gap-3 font-medium rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3"
                              >
                                <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                                <span>{improvement}</span>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Matches */}
              <div className="lg:col-span-8 lg:sticky lg:top-24 lg:self-start lg:h-[calc(100vh-7rem)] flex flex-col">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-10">
                  <div>
                    <h2 className="text-4xl font-black tracking-tighter text-zinc-900">
                      {view === "jobs"
                        ? matches.length > 0
                          ? "Top Matches"
                          : "Jobs in India"
                        : "My Applications"}
                    </h2>
                    <p className="text-sm text-zinc-400 font-medium mt-1">
                      {view === "jobs"
                        ? "Exclusively curated for Indian tech talent"
                        : "Track your career progress"}
                    </p>
                    {view === "jobs" && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="px-3 py-1 rounded-full bg-white border border-zinc-200 text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
                          {filteredMatches.length} visible jobs
                        </span>
                        <span className="px-3 py-1 rounded-full bg-zinc-50 border border-zinc-200 text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
                          Avg match {averageMatchScore}%
                        </span>
                        <span className="px-3 py-1 rounded-full bg-zinc-50 border border-zinc-200 text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
                          {savedJobIds.length} saved
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest ${activeFilterCount > 0 ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-zinc-50 border-zinc-200 text-zinc-500"}`}
                        >
                          {activeFilterCount > 0
                            ? `${activeFilterCount} active filters`
                            : "No active filters"}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2 bg-white p-1 rounded-2xl border border-zinc-200 shadow-sm">
                      <button
                        onClick={() => setView("jobs")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${view === "jobs" ? "bg-zinc-900 text-white shadow-md" : "text-zinc-400 hover:text-zinc-600"}`}
                      >
                        Matches
                      </button>
                      <button
                        onClick={() => setView("applications")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${view === "applications" ? "bg-zinc-900 text-white shadow-md" : "text-zinc-400 hover:text-zinc-600"}`}
                      >
                        Applications
                      </button>
                    </div>
                    {view === "jobs" && (
                      <>
                        <button
                          onClick={handleFetchRealtimeJobs}
                          disabled={fetchingJobs}
                          className="flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-2xl text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-lg shadow-zinc-200 disabled:opacity-50"
                        >
                          {fetchingJobs ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4 text-amber-400" />
                          )}
                          {fetchingJobs ? "Searching..." : "Fetch Latest Jobs"}
                        </button>
                        <div className="relative w-full sm:w-72">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                          <input
                            placeholder="Filter by city (e.g. Bangalore)"
                            className="flex h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all pl-11 shadow-sm"
                            value={locationFilter}
                            onChange={(e) => setLocationFilter(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {view === "jobs" ? (
                  <>
                    {currentResume && (
                      <div className="mb-8">
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-4">
                          Filter by your skills
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {currentResume.parsedJson.skills.map((skill, i) => (
                            <button
                              key={i}
                              onClick={() => toggleSkill(skill)}
                              className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${
                                selectedSkills.includes(skill)
                                  ? "bg-zinc-900 text-white border-zinc-900 shadow-md"
                                  : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                              }`}
                            >
                              {skill}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto pr-4 space-y-6 scrollbar-hide">
                      {filteredMatches.length > 0 ? (
                        filteredMatches.map((match, i) => (
                          <div key={match.job.id} className="group">
                            <div className="bg-white border border-zinc-200 rounded-[24px] shadow-sm hover:shadow-xl hover:shadow-zinc-200/50 transition-all duration-300 overflow-hidden">
                              <div className="p-8">
                                <div className="flex items-start justify-between gap-6">
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-3">
                                      <h3 className="font-black text-2xl tracking-tight text-zinc-900 group-hover:text-zinc-600 transition-colors">
                                        {match.job.title}
                                      </h3>
                                      <span className="px-3 py-1 bg-green-50 text-green-700 border border-green-100 rounded-full text-[10px] font-black uppercase tracking-wider">
                                        {match.score}% Match
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-sm font-bold text-zinc-400">
                                      <span className="flex items-center gap-1.5">
                                        <Briefcase className="w-4 h-4" />
                                        {match.job.company}
                                      </span>
                                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-200" />
                                      <span>{match.job.location}</span>
                                    </div>
                                    <div className="mt-3 w-full max-w-md">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                                          Match Confidence
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                          {match.score}%
                                        </span>
                                      </div>
                                      <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${match.score >= 80 ? "bg-emerald-500" : match.score >= 60 ? "bg-amber-500" : "bg-zinc-500"}`}
                                          style={{
                                            width: `${Math.max(6, Math.min(100, match.score))}%`,
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <button
                                      onClick={() =>
                                        handleToggleSaveJob(match.job.id)
                                      }
                                      className={`p-3 rounded-full border transition-all active:scale-95 ${
                                        savedJobIds.includes(match.job.id)
                                          ? "bg-rose-50 border-rose-100 text-rose-500"
                                          : "bg-white border-zinc-200 text-zinc-400 hover:text-zinc-900 hover:border-zinc-900"
                                      }`}
                                      title={
                                        savedJobIds.includes(match.job.id)
                                          ? "Unsave Job"
                                          : "Save Job"
                                      }
                                    >
                                      <Heart
                                        className={`w-5 h-5 ${savedJobIds.includes(match.job.id) ? "fill-current" : ""}`}
                                      />
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (!currentResume) {
                                          toast.error(
                                            "Please upload your resume first",
                                          );
                                          return;
                                        }
                                        setApplyingJob(match.job);
                                      }}
                                      className="px-6 py-2.5 bg-zinc-900 text-white rounded-full text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-lg shadow-zinc-200 flex items-center gap-2"
                                    >
                                      Apply Now
                                      <TrendingUp className="w-4 h-4 rotate-45" />
                                    </button>
                                    <button className="px-6 py-2.5 bg-white border border-zinc-200 text-zinc-900 rounded-full text-sm font-bold hover:bg-zinc-50 transition-all active:scale-95 shadow-sm">
                                      View Details
                                    </button>
                                  </div>
                                </div>

                                <p className="mt-6 text-sm text-zinc-500 line-clamp-2 leading-relaxed font-medium">
                                  {match.job.description}
                                </p>

                                <div className="mt-6 flex flex-wrap gap-2">
                                  {match.job.requirements
                                    ?.slice(0, 4)
                                    .map((req, idx) => (
                                      <span
                                        key={idx}
                                        className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-2 py-1 bg-zinc-50 rounded"
                                      >
                                        {req}
                                      </span>
                                    ))}
                                </div>
                                {match.job.sourceUrl && (
                                  <a
                                    href={match.job.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex mt-4 text-xs font-bold text-zinc-500 hover:text-zinc-900 transition-colors"
                                  >
                                    View Original Job Posting
                                  </a>
                                )}

                                {coverLetters[match.job.id] ? (
                                  <div className="mt-8 p-6 bg-zinc-50 rounded-2xl border border-zinc-100 relative group/letter">
                                    <div className="flex items-center justify-between mb-4">
                                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                                        <FileText className="w-3.5 h-3.5" />
                                        Generated Cover Letter
                                      </h4>
                                      <button
                                        className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-all shadow-sm"
                                        onClick={() => {
                                          navigator.clipboard.writeText(
                                            coverLetters[match.job.id],
                                          );
                                          toast.success("Copied to clipboard");
                                        }}
                                      >
                                        Copy Text
                                      </button>
                                    </div>
                                    <p className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed font-medium italic">
                                      {coverLetters[match.job.id]}
                                    </p>
                                  </div>
                                ) : (
                                  <div className="mt-8">
                                    <button
                                      className="w-full bg-zinc-50 hover:bg-zinc-100 text-zinc-900 border border-zinc-200 py-4 rounded-2xl font-bold text-sm flex items-center justify-center transition-all active:scale-[0.98] group/btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleGenerateCoverLetter(match.job);
                                      }}
                                      disabled={
                                        generatingCoverLetter === match.job.id
                                      }
                                    >
                                      {generatingCoverLetter ===
                                      match.job.id ? (
                                        <Loader2 className="w-5 h-5 animate-spin mr-3" />
                                      ) : (
                                        <Sparkles className="w-5 h-5 mr-3 text-zinc-400 group-hover/btn:text-zinc-900 transition-colors" />
                                      )}
                                      Generate AI Cover Letter
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="flex flex-col items-center justify-center py-32 text-center border-2 border-dashed border-zinc-200 rounded-[32px] bg-white/50">
                          <div className="w-20 h-20 bg-zinc-100 rounded-3xl flex items-center justify-center mb-6 shadow-inner">
                            <Search className="w-10 h-10 text-zinc-300" />
                          </div>
                          <h3 className="font-black text-2xl tracking-tight text-zinc-900">
                            No matches found
                          </h3>
                          <p className="text-zinc-400 font-medium max-w-xs mx-auto mt-2">
                            Try adjusting your location filter or upload a
                            different resume.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto pr-4 space-y-6 scrollbar-hide">
                    {applications.length > 0 ? (
                      applications.map((app) => {
                        const job = matches.find((m) => m.job.id === app.jobId)
                          ?.job || {
                          title: "Applied Job",
                          company: "Company",
                          location: "Location",
                        };
                        return (
                          <div
                            key={app.id}
                            className="bg-white border border-zinc-200 rounded-[24px] p-8 shadow-sm hover:shadow-md transition-all"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-black text-2xl tracking-tight text-zinc-900">
                                  {job.title}
                                </h3>
                                <div className="flex items-center gap-4 text-sm font-bold text-zinc-400 mt-1">
                                  <span>{job.company}</span>
                                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-200" />
                                  <span>{job.location}</span>
                                </div>
                              </div>
                              <span
                                className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                  app.status === "pending"
                                    ? "bg-amber-50 text-amber-600 border-amber-100"
                                    : app.status === "accepted"
                                      ? "bg-green-50 text-green-600 border-green-100"
                                      : "bg-zinc-50 text-zinc-600 border-zinc-100"
                                }`}
                              >
                                {app.status}
                              </span>
                            </div>
                            <div className="mt-8 flex items-center gap-6 text-xs font-bold text-zinc-400">
                              <span className="flex items-center gap-2">
                                <Bookmark className="w-4 h-4" />
                                Applied on{" "}
                                {new Date(app.appliedAt).toLocaleDateString()}
                              </span>
                              {app.coverLetter && (
                                <span className="flex items-center gap-2">
                                  <FileText className="w-4 h-4" />
                                  Cover Letter Included
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center py-32 text-center border-2 border-dashed border-zinc-200 rounded-[32px] bg-white/50">
                        <div className="w-20 h-20 bg-zinc-100 rounded-3xl flex items-center justify-center mb-6 shadow-inner">
                          <Briefcase className="w-10 h-10 text-zinc-300" />
                        </div>
                        <h3 className="font-black text-2xl tracking-tight text-zinc-900">
                          No applications yet
                        </h3>
                        <p className="text-zinc-400 font-medium max-w-xs mx-auto mt-2">
                          Start applying to jobs to see them here.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Apply Form Modal */}
        {applyingJob && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden border border-zinc-200 animate-in fade-in zoom-in duration-300">
              <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                <div>
                  <h3 className="text-2xl font-black tracking-tight text-zinc-900">
                    Apply for {applyingJob.title}
                  </h3>
                  <p className="text-sm text-zinc-400 font-medium">
                    {applyingJob.company} • {applyingJob.location}
                  </p>
                </div>
                <button
                  onClick={() => setApplyingJob(null)}
                  className="p-2 hover:bg-zinc-200 rounded-full transition-colors text-zinc-400 hover:text-zinc-900"
                >
                  <AlertCircle className="w-6 h-6 rotate-45" />
                </button>
              </div>

              <form onSubmit={handleApply} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Your Resume
                  </label>
                  <div className="flex items-center gap-3 p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <FileText className="w-5 h-5 text-zinc-400" />
                    <span className="text-sm font-bold text-zinc-900">
                      {currentResume?.fileName}
                    </span>
                    <span className="ml-auto text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                      Attached
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="coverLetter"
                    className="text-[10px] font-bold uppercase tracking-widest text-zinc-400"
                  >
                    Cover Letter
                  </label>
                  <textarea
                    id="coverLetter"
                    name="coverLetter"
                    rows={6}
                    defaultValue={coverLetters[applyingJob.id] || ""}
                    placeholder="Tell the employer why you're a great fit..."
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all shadow-sm resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="notes"
                    className="text-[10px] font-bold uppercase tracking-widest text-zinc-400"
                  >
                    Additional Notes (Optional)
                  </label>
                  <input
                    id="notes"
                    name="notes"
                    placeholder="Anything else you'd like to add?"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all shadow-sm"
                  />
                </div>

                <div className="pt-4 flex gap-4">
                  <button
                    type="button"
                    onClick={() => setApplyingJob(null)}
                    className="flex-1 py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold hover:bg-zinc-200 transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingApplication}
                    className="flex-[2] py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-xl shadow-zinc-200 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submittingApplication ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Submit Application
                        <CheckCircle2 className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
