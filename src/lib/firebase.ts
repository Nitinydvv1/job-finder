import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const requiredEnv = (name: string): string => {
	const value = (process.env as Record<string, string | undefined>)[name]?.trim();
	if (!value) {
		throw new Error(`Missing Firebase config: ${name}. Add it to .env.local`);
	}
	return value;
};

const firebaseConfig = {
	projectId: requiredEnv('FIREBASE_PROJECT_ID'),
	appId: requiredEnv('FIREBASE_APP_ID'),
	apiKey: requiredEnv('FIREBASE_API_KEY'),
	authDomain: requiredEnv('FIREBASE_AUTH_DOMAIN'),
	storageBucket: requiredEnv('FIREBASE_STORAGE_BUCKET'),
	messagingSenderId: requiredEnv('FIREBASE_MESSAGING_SENDER_ID'),
	measurementId: process.env.FIREBASE_MEASUREMENT_ID || '',
};

const firestoreDatabaseId = requiredEnv('FIREBASE_FIRESTORE_DATABASE_ID');

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);
