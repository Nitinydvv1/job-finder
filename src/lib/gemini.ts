import { GoogleGenAI, Type } from "@google/genai";
import { ResumeData } from "../types";

let aiInstance: GoogleGenAI | null = null;

const FALLBACK_SKILLS = [
  "Python",
  "JavaScript",
  "TypeScript",
  "React",
  "Node.js",
  "HTML",
  "CSS",
  "SQL",
  "PostgreSQL",
  "MongoDB",
  "Docker",
  "Kubernetes",
  "AWS",
  "Azure",
  "GCP",
  "Git",
  "Linux",
  "Figma",
  "Tailwind",
  "Express",
  "Next.js",
  "Firebase",
  "Redux",
  "REST",
  "GraphQL",
  "Java",
  "C++",
  "C#",
  "Go",
  "Rust",
  "Django",
  "Flask",
  "FastAPI",
  "Machine Learning",
  "TensorFlow",
  "PyTorch",
  "NLP",
];

const SKILL_ALIASES: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "TypeScript", patterns: [/\btypescript\b/i] },
  { label: "JavaScript", patterns: [/\bjavascript\b/i, /\bjs\b/i] },
  { label: "Python", patterns: [/\bpython\b/i] },
  { label: "React", patterns: [/\breact\b/i] },
  { label: "Node.js", patterns: [/\bnode\.?js\b/i] },
  { label: "HTML", patterns: [/\bhtml\b/i] },
  { label: "CSS", patterns: [/\bcss\b/i] },
  { label: "SQL", patterns: [/\bsql\b/i] },
  { label: "PostgreSQL", patterns: [/\bpostgres(?:ql)?\b/i] },
  { label: "MongoDB", patterns: [/\bmongo(?:db)?\b/i] },
  { label: "Docker", patterns: [/\bdocker\b/i] },
  { label: "Kubernetes", patterns: [/\bkubernetes\b/i] },
  { label: "AWS", patterns: [/\baws\b/i, /amazon web services/i] },
  { label: "Azure", patterns: [/\bazure\b/i] },
  { label: "GCP", patterns: [/\bgcp\b/i, /google cloud/i] },
  { label: "Git", patterns: [/\bgit\b/i] },
  { label: "Linux", patterns: [/\blinux\b/i] },
  { label: "Figma", patterns: [/\bfigma\b/i] },
  { label: "Tailwind", patterns: [/\btailwind(?:css)?\b/i] },
  { label: "Express", patterns: [/\bexpress\b/i] },
  { label: "Next.js", patterns: [/\bnext\.?js\b/i] },
  { label: "Firebase", patterns: [/\bfirebase\b/i] },
  { label: "Redux", patterns: [/\bredux\b/i] },
  { label: "REST", patterns: [/\brest\b/i, /rest api/i] },
  { label: "GraphQL", patterns: [/\bgraphql\b/i] },
  { label: "Java", patterns: [/\bjava\b/i] },
  { label: "C++", patterns: [/c\+\+/i] },
  { label: "C#", patterns: [/c#/i] },
  { label: "Go", patterns: [/\bgo\b/i, /golang/i] },
  { label: "Rust", patterns: [/\brust\b/i] },
  { label: "Django", patterns: [/\bdjango\b/i] },
  { label: "Flask", patterns: [/\bflask\b/i] },
  { label: "FastAPI", patterns: [/\bfastapi\b/i] },
  { label: "Machine Learning", patterns: [/machine learning/i] },
  { label: "TensorFlow", patterns: [/\btensorflow\b/i] },
  { label: "PyTorch", patterns: [/\bpytorch\b/i] },
  { label: "NLP", patterns: [/\bnlp\b/i] },
];

const SECTION_HEADINGS = [
  "skills",
  "technical skills",
  "core skills",
  "core competencies",
  "expertise",
  "technologies",
  "tools",
  "experience",
  "work experience",
  "employment",
  "projects",
  "project experience",
  "summary",
  "profile",
  "about",
];

const ACTION_VERBS = [
  "built",
  "developed",
  "designed",
  "implemented",
  "improved",
  "optimized",
  "led",
  "managed",
  "created",
  "launched",
  "reduced",
  "increased",
  "delivered",
  "automated",
  "migrated",
  "analyzed",
  "engineered",
  "collaborated",
  "shipped",
  "maintained",
  "architected",
  "scaled",
  "revamped",
];

function hasGeminiKey() {
  return Boolean(getGeminiApiKey());
}

function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!key) return null;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createFallbackEmbedding(text: string): number[] {
  const dimensions = 1536;
  let seed = 0;

  for (let i = 0; i < text.length; i++) {
    seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  }

  const vector: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    seed = (seed * 1664525 + 1013904223 + i) >>> 0;
    vector.push(((seed % 2000) / 1000) - 1);
  }

  return vector;
}

function extractFallbackSkills(text: string): string[] {
  const sections = splitResumeSections(text);
  const skillsSectionText = getSectionTextByNames(sections, ["skills", "technical skills", "core skills", "core competencies", "expertise", "technologies", "tools"]);
  const experienceText = getSectionTextByNames(sections, ["experience", "work experience", "employment", "projects", "project experience"]);
  const haystack = skillsSectionText || experienceText || text;
  const foundSkills: string[] = [];

  for (const skill of SKILL_ALIASES) {
    if (skill.patterns.some((pattern) => pattern.test(haystack))) {
      foundSkills.push(skill.label);
    }
  }

  return Array.from(new Set(foundSkills));
}

function normalizeHeading(line: string): string | null {
  const cleaned = line.replace(/[:\-]+$/g, "").trim().toLowerCase();
  return SECTION_HEADINGS.includes(cleaned) ? cleaned : null;
}

function splitResumeSections(text: string): Record<string, string[]> {
  const lines = text.replace(/\r/g, "\n").split("\n");
  const sections: Record<string, string[]> = {};
  let currentSection = "preamble";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const heading = normalizeHeading(line);
    if (heading) {
      currentSection = heading;
      if (!sections[currentSection]) {
        sections[currentSection] = [];
      }
      continue;
    }

    if (!sections[currentSection]) {
      sections[currentSection] = [];
    }

    sections[currentSection].push(line);
  }

  return sections;
}

function getSectionTextByNames(sections: Record<string, string[]>, names: string[]): string {
  return names.flatMap((name) => sections[name] ?? []).join("\n");
}

function getBulletLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d+[.)])\s+/.test(line));
}

function getAverageWordCount(lines: string[]): number {
  if (lines.length === 0) {
    return 0;
  }

  const totalWords = lines.reduce((sum, line) => sum + getWordCount(line), 0);
  return totalWords / lines.length;
}

function getActionVerbCount(lines: string[]): number {
  return lines.filter((line) =>
    ACTION_VERBS.some((verb) => new RegExp(`^([-*•]|\\d+[.)])\\s+${verb}\\b`, "i").test(line)),
  ).length;
}

function createFallbackSummary(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Resume uploaded successfully. Local parsing fallback was used because Gemini is not configured.";
  }

  return cleaned.slice(0, 260);
}

function createFallbackResumeData(text: string): ResumeData {
  return {
    skills: extractFallbackSkills(text),
    experience: [],
    education: [],
    summary: createFallbackSummary(text),
  };
}

function getWordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function hasSection(text: string, sectionName: string): boolean {
  return new RegExp(`\\b${sectionName}\\b`, "i").test(text);
}

function hasNumbers(text: string): boolean {
  return /\d/.test(text);
}

function buildLocalReview(text: string): { mistakes: string[]; improvements: string[] } {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sections = splitResumeSections(text);
  const wordCount = getWordCount(normalized);
  const skillsText = getSectionTextByNames(sections, ["skills", "technical skills", "core skills", "core competencies", "expertise", "technologies", "tools"]);
  const experienceText = getSectionTextByNames(sections, ["experience", "work experience", "employment"]);
  const projectText = getSectionTextByNames(sections, ["projects", "project experience"]);
  const educationText = getSectionTextByNames(sections, ["education"]);
  const hasSkillsSection = Boolean(skillsText);
  const hasExperienceSection = Boolean(experienceText || projectText);
  const hasEducationSection = Boolean(educationText);
  const extractedSkills = extractFallbackSkills(skillsText || normalized);
  const hasMetrics = hasNumbers(experienceText || projectText || normalized);
  const bulletLines = [...getBulletLines(experienceText), ...getBulletLines(projectText)];
  const avgBulletLength = getAverageWordCount(bulletLines);
  const actionVerbCount = getActionVerbCount(bulletLines);

  const mistakes: string[] = [];
  const improvements: string[] = [];

  if (wordCount < 150) {
    mistakes.push("The resume is very short, so recruiters may not get enough signal about your background.");
    improvements.push("Add more detail to experience and project bullets so each role shows clear impact.");
  }

  if (!hasSkillsSection) {
    mistakes.push("A dedicated skills section is missing or hard to detect.");
    improvements.push("Add a clear Skills or Technical Skills section with only the technologies you actually used.");
  } else if (extractedSkills.length < 3) {
    mistakes.push("The skills section is too sparse to highlight your technical stack.");
    improvements.push("List 4 to 8 explicit tools, languages, frameworks, or platforms in the skills section.");
  }

  if (!hasExperienceSection) {
    mistakes.push("Work experience or project experience is not clearly separated into a dedicated section.");
    improvements.push("Add a dedicated experience or projects section with job titles, dates, and bullet points.");
  } else if (bulletLines.length === 0) {
    mistakes.push("Experience and project entries are not using bullet points, so they are harder to scan.");
    improvements.push("Rewrite responsibilities as short bullet points with one idea per line.");
  } else {
    if (avgBulletLength > 24) {
      improvements.push("Shorten long bullets so each one is easier to read at a glance.");
    }

    if (actionVerbCount < Math.max(1, Math.ceil(bulletLines.length / 2))) {
      mistakes.push("Many bullets do not start with strong action verbs.");
      improvements.push("Start bullets with verbs like built, improved, led, designed, or automated.");
    }
  }

  if (!hasEducationSection) {
    improvements.push("Include an education section if it matters for the roles you are targeting.");
  }

  if (!hasMetrics) {
    mistakes.push("The resume does not show measurable impact or results.");
    improvements.push("Add numbers where possible, such as percentages, user counts, timelines, or performance gains.");
  }

  if (improvements.length === 0) {
    improvements.push("Tailor the summary and experience bullets to the role you are applying for.");
    improvements.push("Keep bullet points concise and make sure each bullet has a clear result.");
  }

  if (mistakes.length === 0) {
    mistakes.push("The resume is readable, but the impact and structure can still be made sharper.");
  }

  return { mistakes, improvements };
}

function buildResumeSpecificReview(text: string, resume: ResumeData): { mistakes: string[]; improvements: string[] } {
  const baseReview = buildLocalReview(text);
  const detectedSkills = Array.from(new Set((resume.skills || []).map((skill) => skill.trim()).filter(Boolean)));
  const experienceCount = resume.experience?.length ?? 0;
  const educationCount = resume.education?.length ?? 0;
  const summaryWordCount = getWordCount(resume.summary || "");

  const mistakes = [...baseReview.mistakes];
  const improvements = [...baseReview.improvements];

  if (detectedSkills.length > 0) {
    if (detectedSkills.length < 5) {
      mistakes.push(`Only ${detectedSkills.length} explicit skill${detectedSkills.length === 1 ? " is" : "s are"} being surfaced, so the technical profile may look thin.`);
      improvements.push(`If the resume truly includes more skills, make the Skills section clearer so tools like ${detectedSkills.slice(0, 3).join(", ")} are easy to spot.`);
    } else {
      improvements.push(`The resume does a good job surfacing core skills like ${detectedSkills.slice(0, 5).join(", ")}. Keep that section concise and explicit.`);
    }
  }

  if (experienceCount > 0) {
    if (experienceCount === 1) {
      improvements.push("Add more than one experience or project entry if you have them, so the career story feels stronger.");
    } else {
      improvements.push(`Good: the resume includes ${experienceCount} experience entries. Make sure each one shows impact, not just duties.`);
    }
  }

  if (educationCount > 0) {
    improvements.push(`Education is present with ${educationCount} entry${educationCount === 1 ? "" : "ies"}. Keep it brief unless it is your strongest selling point.`);
  }

  if (summaryWordCount > 0 && summaryWordCount < 40) {
    mistakes.push("The summary is very short and may not clearly position the candidate.");
    improvements.push("Expand the summary so it explains your niche, strengths, and target role in 2 to 3 lines.");
  }

  return {
    mistakes: Array.from(new Set(mistakes)).slice(0, 4),
    improvements: Array.from(new Set(improvements)).slice(0, 4),
  };
}

function getAI() {
  if (!aiInstance) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key is missing. Set GEMINI_API_KEY or VITE_GEMINI_API_KEY in .env.local and restart the dev server.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

export async function parseResume(text: string): Promise<ResumeData> {
  try {
    if (!hasGeminiKey()) {
      return createFallbackResumeData(text);
    }

    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are an expert resume parser. Extract exhaustive structured JSON from the following resume text. 
      
      CRITICAL INSTRUCTIONS FOR SKILLS EXTRACTION:
      1. Scan the ENTIRE resume (Summary, Experience, Projects, Education, and Skills sections) for technical keywords.
      2. Capture EVERY explicitly mentioned technical skill. This includes:
         - Programming Languages (e.g., Python, JavaScript, C++, Rust)
         - DevOps & Infrastructure (e.g., Docker, Linux, Kubernetes, Terraform, AWS, Azure, GCP)
         - Operating Systems (e.g., Linux, Windows, macOS)
         - Frameworks & Libraries (e.g., React, Node.js, Spring Boot, PyTorch)
         - Databases & Data Tools (e.g., PostgreSQL, Redis, Spark, Hadoop)
         - Tools & Version Control (e.g., Git, Jenkins, Jira, Postman)
      3. Pay special attention to tools like "Docker" and "Linux" which are often mentioned in passing within experience descriptions.
      4. ONLY extract skills that are EXPLICITLY mentioned. DO NOT infer skills from job titles, company names, project names, or industry context.
      5. Prefer the Skills / Technical Skills / Core Competencies section when it exists.
      6. Do not add generic business terms, soft skills, or unrelated technologies that are not directly written in the resume.
      7. The summary should be a unique, professional 200-word overview specifically tailored to this candidate's unique experience and technical stack as described in the text.
      8. Ensure all experience entries are captured with detailed descriptions.

      Resume Text:
      ${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            skills: { type: Type.ARRAY, items: { type: Type.STRING } },
            experience: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  company: { type: Type.STRING },
                  role: { type: Type.STRING },
                  duration: { type: Type.STRING },
                  description: { type: Type.STRING }
                },
                required: ["company", "role", "duration"]
              }
            },
            education: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  institution: { type: Type.STRING },
                  degree: { type: Type.STRING },
                  year: { type: Type.STRING }
                },
                required: ["institution", "degree"]
              }
            },
            summary: { type: Type.STRING, description: "A 200-word summary of the candidate" }
          },
          required: ["skills", "experience", "education", "summary"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Parse Error:", error);
    throw error;
  }
}

export async function rankJobs(resume: ResumeData, jobs: any[]): Promise<{ jobId: string, score: number }[]> {
  if (!hasGeminiKey()) {
    return jobs.map((job, index) => ({
      jobId: job.id ?? String(index),
      score: Math.max(0, 100 - index * 5),
    }));
  }

  const jobsList = jobs.map(j => `ID: ${j.id}\nTitle: ${j.title}\nCompany: ${j.company}\nDescription: ${j.description}`).join('\n---\n');
  
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Compare the following resume with the list of jobs and rank them by suitability. Return a JSON array of objects with "jobId" and "score" (0-100).\n\nResume:\n${JSON.stringify(resume)}\n\nJobs:\n${jobsList}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            jobId: { type: Type.STRING },
            score: { type: Type.NUMBER }
          },
          required: ["jobId", "score"]
        }
      }
    }
  });

  return JSON.parse(response.text);
}

export async function getEmbedding(text: string): Promise<number[]> {
  try {
    if (!hasGeminiKey()) {
      return createFallbackEmbedding(text);
    }

    const ai = getAI();
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: [text],
    });
    return result.embeddings[0].values;
  } catch (error) {
    console.error("Gemini Embedding Error:", error);
    throw error;
  }
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function generateCoverLetter(resume: ResumeData, job: any): Promise<string> {
  if (!hasGeminiKey()) {
    const skills = resume.skills.length ? resume.skills.join(", ") : "relevant experience";
    return `Dear Hiring Manager,\n\nI am writing to express my interest in the ${job.title} role at ${job.company}. My background includes ${skills}, and I am excited about the opportunity to contribute to your team.\n\nSincerely,\nA motivated candidate`;
  }

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Write a professional and compelling cover letter for the following job based on the candidate's resume. Keep it concise and impactful.\n\nResume:\n${JSON.stringify(resume)}\n\nJob:\nTitle: ${job.title}\nCompany: ${job.company}\nDescription: ${job.description}`,
  });

  return response.text;
}

export async function reviewResume(text: string, resumeData?: ResumeData): Promise<{ mistakes: string[], improvements: string[] }> {
  if (!hasGeminiKey()) {
    return resumeData ? buildResumeSpecificReview(text, resumeData) : buildLocalReview(text);
  }

  const ai = getAI();
  const resumeContext = resumeData
    ? JSON.stringify(
        {
          skills: resumeData.skills,
          experienceCount: resumeData.experience.length,
          educationCount: resumeData.education.length,
          summary: resumeData.summary,
          experience: resumeData.experience,
          education: resumeData.education,
        },
        null,
        2,
      )
    : "No parsed resume data was provided.";

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are an expert resume reviewer.

Review the resume below and write feedback that is specific to this exact resume.

Rules:
1. Do NOT give generic advice that could apply to any candidate.
2. Reference the actual skills, sections, and structure found in the resume data.
3. Write the feedback as if it is for the resume itself.
4. Keep the tone direct, professional, and practical.
5. Return exactly a JSON object with two arrays: "mistakes" and "improvements".
6. Each array should contain 2 to 4 concise bullets.
7. If the resume already has explicit skills, mention them by name.
8. If a section is missing or weak, call that out specifically.

Parsed Resume Data:
${resumeContext}

Raw Resume Text:
${text}`,
    config: {
      tools: [], // No tools needed here
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mistakes: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["mistakes", "improvements"]
      }
    }
  });

  return JSON.parse(response.text);
}

export async function fetchLatestJobs(): Promise<any[]> {
  try {
    if (!hasGeminiKey()) {
      return [];
    }

    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Search for 15 latest software engineering and tech jobs in India (posted in the last 7 days) from LinkedIn, Indeed, and other platforms. Return a JSON array of objects with: title, company, location, description, requirements (array of strings), and sourceUrl (the direct link to the job posting).",
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              company: { type: Type.STRING },
              location: { type: Type.STRING },
              description: { type: Type.STRING },
              requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
              sourceUrl: { type: Type.STRING }
            },
            required: ["title", "company", "location", "description", "requirements", "sourceUrl"]
          }
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Search Error:", error);
    throw error;
  }
}
