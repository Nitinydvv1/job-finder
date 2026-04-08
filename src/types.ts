export interface ResumeData {
  skills: string[];
  experience: {
    company: string;
    role: string;
    duration: string;
    description: string;
  }[];
  education: {
    institution: string;
    degree: string;
    year: string;
  }[];
  summary: string;
}

export interface Resume {
  id: string;
  userId: string;
  fileName: string;
  parsedJson: ResumeData;
  embedding: number[];
  createdAt: string;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string;
  requirements: string[];
  embedding: number[];
  sourceUrl?: string;
  createdAt: string;
}

export interface MatchResult {
  job: Job;
  score: number;
}

export interface Application {
  id: string;
  userId: string;
  jobId: string;
  status: 'pending' | 'reviewed' | 'accepted' | 'rejected';
  appliedAt: string;
  resumeId: string;
  coverLetter?: string;
  notes?: string;
}
