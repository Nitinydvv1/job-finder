import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const sampleJobs = [
  {
    title: "Senior Full Stack Engineer",
    company: "TechFlow Solutions",
    location: "Remote",
    description: "We are looking for a Senior Full Stack Engineer with expertise in React, Node.js, and PostgreSQL. Experience with AI integration and vector databases is a plus."
  },
  {
    title: "Frontend Developer (React)",
    company: "Creative Digital",
    location: "New York, NY",
    description: "Join our team to build beautiful, responsive user interfaces using React, Tailwind CSS, and Framer Motion."
  },
  {
    title: "Backend Architect",
    company: "DataScale Systems",
    location: "San Francisco, CA",
    description: "Lead the design and implementation of scalable backend systems using Express, Redis, and distributed queues."
  },
  {
    title: "AI/ML Engineer",
    company: "FutureMind AI",
    location: "Austin, TX",
    description: "Develop and deploy machine learning models. Experience with LLMs, prompt engineering, and embeddings is essential."
  },
  {
    title: "Product Designer",
    company: "UserFirst Design",
    location: "Remote",
    description: "Design intuitive and accessible user experiences. Proficiency in Figma and a strong eye for typography and layout are required."
  }
];

async function seed() {
  console.log("Seeding jobs...");
  for (const job of sampleJobs) {
    await addDoc(collection(db, 'jobs'), {
      ...job,
      createdAt: new Date().toISOString()
    });
    console.log(`Added job: ${job.title}`);
  }
  console.log("Seeding complete!");
}

seed().catch(console.error);
