import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInWithRedirect,
    signInWithPopup,
    getRedirectResult,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from 'firebase/auth';
import {
    getFirestore,
    doc,
    setDoc,
    updateDoc,
    onSnapshot,
    collection,
    query,
    where,
    addDoc
} from 'firebase/firestore';

// --- Firebase Configuration ---
// NOTE FOR DEPLOYMENT: For a real production environment, these values should be
// loaded from secure environment variables (like on Vercel) and not hardcoded in the source code.
const firebaseConfig = {
    apiKey: process.env.REACT_APP_API,
    authDomain: process.env.REACT_APP_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_PROJECT_ID,
    storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_APP_ID,
    measurementId: process.env.REACT_APP_MEASUREMENT_ID,
    imageapiKey: process.env.REACT_APP_GEMINI_API
};

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Set auth persistence to preserve login state
setPersistence(auth, browserLocalPersistence)
    .then(() => {
        console.log("Auth persistence set to local storage");
    })
    .catch((error) => {
        console.error("Error setting auth persistence:", error);
    });

// Debug: Check if Firebase is initialized correctly
console.log("Firebase initialized with config:", {
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId
});

// --- Main App Component ---
function App() {
    const [page, setPage] = useState('landing');
    const [user, setUser] = useState(null); // eslint-disable-line @typescript-eslint/no-unused-vars
    const [profile, setProfile] = useState(null);
    const [uploadedFiles, setUploadedFiles] = useState([]);
    const [generatedImages, setGeneratedImages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(true); // New state for auth loading
    const [isTextLoading, setIsTextLoading] = useState(false);
    const [error, setError] = useState('');
    const [customPrompt, setCustomPrompt] = useState('');
    const [styleSuggestions, setStyleSuggestions] = useState([]);
    const [linkedInBio, setLinkedInBio] = useState('');



    // --- Authentication Effect ---
    useEffect(() => {
        // Set up auth state listener to track user authentication
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            console.log("Auth state changed:", currentUser);
            console.log("Setting user state and page to dashboard if authenticated");
            setUser(currentUser);
            if (currentUser) {
                // User is authenticated, set page to dashboard
                console.log("User authenticated, setting page to dashboard");
                setPage('dashboard');
            } else {
                console.log("No user authenticated, keeping current page state");
            }
            setIsAuthLoading(false); // Stop loading when auth state is determined
        });

        // Also check current auth state immediately
        const currentUser = auth.currentUser;
        console.log("Current auth state on mount:", currentUser);
        if (currentUser) {
            console.log("User already authenticated on mount, setting page to dashboard");
            setPage('dashboard');
            setUser(currentUser);
            setIsAuthLoading(false);
        }

        // Check if we're coming back from an authentication redirect
        const urlParams = new URLSearchParams(window.location.search);
        const hasAuthParams = urlParams.has('apiKey') || urlParams.has('authType') ||
                             window.location.href.includes('__/auth/handler');
        
        console.log("Auth effect - URL contains auth params:", hasAuthParams);
        console.log("Current URL:", window.location.href);

        // Process the redirect result when the component mounts.
        // This finalizes the sign-in process initiated by signInWithRedirect.
        // Use a small delay to ensure Firebase is fully initialized
        const processRedirect = setTimeout(() => {
            console.log("Processing redirect result...");
            console.log("Current URL:", window.location.href);
            console.log("Has auth params:", hasAuthParams);
            
            getRedirectResult(auth)
                .then((result) => {
                    console.log("Redirect result received:", !!result);
                    if (result) {
                        // User successfully signed in with redirect
                        console.log("Redirect sign-in successful:", result.user);
                        console.log("Redirect result:", result);
                        
                        // Force a re-check of auth state to ensure user is properly set
                        auth.currentUser?.reload().then(() => {
                            console.log("User reloaded after redirect");
                        }).catch(err => {
                            console.error("Error reloading user:", err);
                        });
                    } else {
                        console.log("No redirect result - user may have navigated directly or session expired");
                        console.log("Current auth state:", auth.currentUser);
                    }
                    // Always stop auth loading after processing redirect result
                    setIsAuthLoading(false);
                })
                .catch((error) => {
                    // Handle errors here, such as the user closing the sign-in window.
                    console.error("Auth redirect error details:", {
                        code: error.code,
                        message: error.message,
                        email: error.email,
                        credential: error.credential
                    });
                    
                    // Only show error if it's not a redirect cancellation
                    if (error.code !== 'auth/redirect-cancelled-by-user') {
                        setError(`Failed to complete sign-in: ${error.message}. Please try again.`);
                    }
                    // If the redirect fails, we should stop the loading indicator.
                    setIsAuthLoading(false);
                });
        }, hasAuthParams ? 3000 : 1000); // Longer delay if we have auth params

        return () => {
            clearTimeout(processRedirect);
            unsubscribe(); // Clean up auth listener
        };
    
    }, []); // This should only run ONCE on component mount.

    // --- User Profile & Data Listener Effect ---
    useEffect(() => {
        if (!user) return;

        // Profile listener
        const profileRef = doc(db, 'profiles', user.uid);
        const unsubscribeProfile = onSnapshot(profileRef, (docSnap) => {
            if (docSnap.exists()) {
                setProfile(docSnap.data());
            } else {
                // Create profile for new user
                setDoc(profileRef, {
                    userId: user.uid,
                    email: user.email,
                    credits: 0,
                }).catch(err => console.error("Error creating profile:", err));
            }
        });

        // Generations listener
        const generationsQuery = query(collection(db, 'generations'), where('userId', '==', user.uid));
        const unsubscribeGenerations = onSnapshot(generationsQuery, (querySnapshot) => {
            const images = [];
            querySnapshot.forEach((doc) => {
                images.push(...doc.data().images);
            });
            const uniqueImages = [...new Set(images)];
            setGeneratedImages(uniqueImages.reverse());
        });

        return () => {
            unsubscribeProfile();
            unsubscribeGenerations();
        };
    }, [user]);
    
    // --- Gemini Text Generation Helper ---
    const generateTextWithGemini = async (prompt, isJson = false) => {
        // TODO: For this to work in production, you must provide your Gemini API key,
        // ideally through a secure environment variable.
        const apiKey = process.env.REACT_APP_API; 
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
        
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            ...(isJson && { 
                generationConfig: { 
                    responseMimeType: "application/json"
                } 
            })
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(`Gemini API Error: ${errorBody.error?.message || 'Unknown error'}`);
        }

        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text;
    };


    // --- Helper Functions ---
    const handleSignIn = () => {
        setIsAuthLoading(true); // Give immediate feedback
        const provider = new GoogleAuthProvider();
        
        console.log("Initiating Google login with redirect...");
        console.log("Current domain:", window.location.hostname);
        console.log("Auth domain:", firebaseConfig.authDomain);
        
        // For local development, we need to handle the redirect manually
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log("Local development detected - using popup instead of redirect");
            
            // Use signInWithPopup for local development to avoid redirect issues
            signInWithPopup(auth, provider)
                .then((result) => {
                    console.log("Popup sign-in successful:", result.user);
                    setUser(result.user);
                    setPage('dashboard');
                })
                .catch((error) => {
                    console.error("Popup sign-in error:", error);
                    setError("Could not complete sign-in. Please check browser settings for pop-ups.");
                })
                .finally(() => {
                    setIsAuthLoading(false);
                });
        } else {
            // Production - use redirect
            signInWithRedirect(auth, provider)
                .then(() => {
                    console.log("Google login redirect initiated successfully");
                    sessionStorage.setItem('loginRedirectTime', Date.now());
                })
                .catch((error) => {
                    console.error("Google login error:", error);
                    setError("Could not start sign-in process. Please check browser settings for pop-ups or third-party cookies.");
                    setIsAuthLoading(false);
                    console.error(error.message);
                });
        }
    };

    const handleSignOut = () => {
        signOut(auth).catch((error) => setError(error.message));
    };

    const handleBuyCredits = async () => {
        if (!user) return;
        setIsLoading(true);
        setError('');
        try {
            const profileRef = doc(db, 'profiles', user.uid);
            await updateDoc(profileRef, {
                credits: (profile?.credits || 0) + 50
            });
        } catch (err) {
            setError('Failed to add credits. Please try again.');
            console.error(err);
        }
        setIsLoading(false);
    };

    const handleFileChange = (e) => {
        if (e.target.files.length > 5) {
            setError("You can upload a maximum of 5 images.");
            return;
        }
        setUploadedFiles(Array.from(e.target.files));
        setError('');
    };

    const toBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });

    const handleGenerate = async () => {
        if (uploadedFiles.length === 0) {
            setError("Please upload at least one selfie.");
            return;
        }
        if (profile?.credits < 50) {
            setError("You need at least 50 credits to generate headshots.");
            return;
        }

        setIsLoading(true);
        setError('');
        setLinkedInBio('');

        try {
            const profileRef = doc(db, 'profiles', user.uid);
            await updateDoc(profileRef, { credits: profile.credits - 50 });

            const imagePromises = uploadedFiles.map(file => toBase64(file));
            const base64Images = await Promise.all(imagePromises);
            
            const generated = [];
            
            for (const base64Image of base64Images) {
                // TODO: For this to work in production, you must provide your Gemini API key,
                // ideally through a secure environment variable.
                 const imageapiKey = process.env.REACT_APP_GEMINI_API;
                 const apiUrl = `https://ai-professional-headshot-generator-25795193617.us-west1.run.app?key=${imageapiKey}`;

                 const systemInstruction = "You are an expert photographer specializing in professional headshots. Your task is to generate a high-quality, photorealistic headshot based on the person in the provided image, following the user's style request. The final image should be clean, professional, and suitable for corporate or personal branding use.";
                 const userStyleRequest = customPrompt 
                    ? `Style request: ${customPrompt}` 
                    : "Style request: A standard corporate headshot with a neutral, soft-focus background and professional lighting.";
                 const finalPrompt = `${systemInstruction}\n\n${userStyleRequest}`;

                 const payload = {
                    contents: [{
                        parts: [
                            { text: finalPrompt },
                            { inlineData: { mimeType: "image/jpeg", data: base64Image } }
                        ]
                    }],
                    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
                };

                 const response = await fetch(apiUrl, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify(payload)
                 });
                 
                if (!response.ok) {
                    const errorBody = await response.json();
                    throw new Error(`API Error: ${errorBody.error?.message || 'Unknown error'}`);
                }

                 const result = await response.json();
                 const base64Data = result?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
                 
                 if (base64Data) {
                     generated.push(`data:image/png;base64,${base64Data}`);
                 }
            }

            if(generated.length === 0) {
                throw new Error("The AI failed to generate images. Your credits have been refunded.");
            }

            await addDoc(collection(db, 'generations'), {
                userId: user.uid,
                images: generated,
                createdAt: new Date(),
            });

            setUploadedFiles([]);
        } catch (err) {
            setError(`Generation failed: ${err.message}. Refunding credits.`);
            console.error(err);
            const profileRef = doc(db, 'profiles', user.uid);
            await updateDoc(profileRef, { credits: profile?.credits || 0 });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSuggestStyles = async () => {
        setIsTextLoading(true);
        setError('');
        setStyleSuggestions([]);
        const prompt = `You are a creative director. Brainstorm 5 distinct and professional styles for a corporate headshot. For each, provide a short, catchy name and a brief description (less than 15 words). Return ONLY the JSON array of objects, where each object has a "name" and "description" key. Example: [{"name": "The CEO", "description": "Confident, powerful, with a dark, moody background."}]`;
        try {
            const responseText = await generateTextWithGemini(prompt, true);
            const suggestions = JSON.parse(responseText);
            setStyleSuggestions(suggestions);
        } catch (err) {
            setError("Could not generate style suggestions. Please try again.");
            console.error(err);
        } finally {
            setIsTextLoading(false);
        }
    };

    const handleGenerateBio = async () => {
        setIsTextLoading(true);
        setError('');
        setLinkedInBio('');
        const prompt = `You are a professional branding expert and copywriter. Write a compelling and professional LinkedIn 'About' section summary. The tone should be confident and engaging. The summary should be approximately 4-5 sentences long. The user's recent headshot was generated with the following style prompt: '${customPrompt || 'Standard professional headshot'}'. Use this style as inspiration for the tone of the bio.`;
        try {
            const bioText = await generateTextWithGemini(prompt);
            setLinkedInBio(bioText);
        } catch (err) {
            setError("Could not generate LinkedIn bio. Please try again.");
            console.error(err);
        } finally {
            setIsTextLoading(false);
        }
    };
    
    // --- UI Components ---
    const LegalPage = ({ title, children, onBack }) => (
        <div className="w-full min-h-screen bg-gray-100 text-gray-800">
             <header className="bg-white shadow-sm">
                <div className="container mx-auto px-6 py-4 flex justify-between items-center">
                    <h1 className="text-2xl font-bold">AI Headshot Generator</h1>
                     <button onClick={onBack} className="text-indigo-600 hover:text-indigo-800 font-bold py-2 px-4 rounded-lg transition-colors">
                        &larr; Back to Home
                    </button>
                </div>
            </header>
            <main className="container mx-auto px-6 py-12">
                <div className="bg-white p-8 rounded-lg shadow-md max-w-4xl mx-auto">
                    <h2 className="text-3xl font-extrabold mb-6">{title}</h2>
                    <div className="prose max-w-none">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
    
    const PrivacyPolicy = ({ onBack }) => (
        <LegalPage title="Privacy Policy" onBack={onBack}>
            <p><strong>Last Updated: September 16, 2025</strong></p>
            <p>Your privacy is important to us. This Privacy Policy explains how we collect, use, and share information about you when you use our AI Headshot Generator service.</p>
            <h3>Information We Collect</h3>
            <ul>
                <li><strong>Account Information:</strong> When you create an account, we collect your email address and name as provided by Google Sign-In.</li>
                <li><strong>Uploaded Images:</strong> We collect the selfies you upload to generate your headshots. These images are stored securely and are used solely for the purpose of generating your AI headshots.</li>
                <li><strong>Generated Images:</strong> We store the headshots generated for you, which are accessible only through your account.</li>
                <li><strong>Usage Data:</strong> We may collect data about your interactions with our service, such as which features you use.</li>
            </ul>
            <h3>How We Use Your Information</h3>
            <ul>
                <li>To provide, maintain, and improve our service.</li>
                <li>To process your requests for generating AI headshots.</li>
                <li>To communicate with you about your account and our services.</li>
                <li>To enforce our terms and prevent fraudulent activity.</li>
            </ul>
            <h3>Data Sharing</h3>
            <p>We do not sell your personal information. We may share your uploaded images with our AI model provider (Google Gemini) for the sole purpose of generating your headshots. These images are not used to train the AI model.</p>
            <h3>Data Retention</h3>
            <p>We retain your uploaded and generated images for as long as your account is active to allow you to access them. You may delete your account at any time, which will result in the deletion of your personal data and images.</p>
        </LegalPage>
    );

    const TermsOfService = ({ onBack }) => (
        <LegalPage title="Terms of Service" onBack={onBack}>
            <p><strong>Last Updated: September 16, 2025</strong></p>
            <p>By using the AI Headshot Generator (the "Service"), you agree to these Terms of Service. Please read them carefully.</p>
            <h3>1. Your Account</h3>
            <p>You are responsible for safeguarding your account. You agree not to disclose your password to any third party. You must notify us immediately upon becoming aware of any breach of security or unauthorized use of your account.</p>
            <h3>2. Use of the Service</h3>
            <p>You agree to use the Service only for lawful purposes. You must not upload any images that are illegal, obscene, defamatory, or that infringe upon the intellectual property rights of others. You retain all ownership rights to the selfies you upload.</p>
            <h3>3. Generated Content</h3>
            <p>You are granted full ownership and commercial rights to the headshots generated by the Service from your uploaded images. The Service uses AI, and the generated content may occasionally contain artifacts or inaccuracies. We are not liable for any such imperfections.</p>
            <h3>4. Credits and Payment</h3>
            <p>The Service operates on a credit-based system. Credits are purchased in packs and are non-refundable. One generation cycle consumes a fixed number of credits as specified on the pricing page. If a generation fails due to a technical error on our part, credits will be refunded.</p>
            <h3>5. Termination</h3>
            <p>We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.</p>
        </LegalPage>
    );

    const LandingPage = () => (
        <div className="w-full min-h-screen bg-gray-900 text-white">
            <header className="container mx-auto px-6 py-4 flex justify-between items-center">
                <h1 className="text-2xl font-bold">AI Headshot Generator</h1>
                <button
                    onClick={() => {
                        console.log("Login button clicked - calling handleSignIn");
                        console.log("Window location:", window.location.href);
                        handleSignIn();
                    }}
                    disabled={isAuthLoading}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-indigo-400 flex items-center justify-center">
                    {isAuthLoading ? <Spinner small /> : 'Login / Get Started'}
                </button>
            </header>
            <main className="container mx-auto px-6 text-center pt-24 pb-12">
                <h2 className="text-5xl md:text-6xl font-extrabold leading-tight mb-4">
                    Studio-Quality Headshots. <br />Generated in Minutes.
                </h2>
                <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
                    Upload your selfies, and let our AI create professional headshots for your LinkedIn, website, or resume. No photoshoot required.
                </p>
                <div className="flex justify-center">
                    <button 
                        onClick={handleSignIn} 
                        disabled={isAuthLoading}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-lg text-lg transition-transform transform hover:scale-105 disabled:bg-indigo-400 flex items-center justify-center">
                        {isAuthLoading ? <Spinner small /> : 'Get Your Headshots Now'}
                    </button>
                </div>

                <div className="mt-20">
                    <h3 className="text-3xl font-bold mb-8">Examples</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
                        {[1, 2, 3, 4].map(i => (
                            <img key={i} src={`https://placehold.co/400x400/111827/7C3AED?text=Example+${i}`} alt={`Example ${i}`} className="rounded-lg shadow-lg" />
                        ))}
                    </div>
                </div>

                <div className="mt-20 max-w-3xl mx-auto" id="pricing">
                    <h3 className="text-3xl font-bold mb-8">Simple, One-Time Pricing</h3>
                    <div className="bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                        <h4 className="text-2xl font-bold">Starter Pack</h4>
                        <p className="text-5xl font-extrabold my-4">$29</p>
                        <p className="text-gray-400">One-time purchase</p>
                        <ul className="text-left my-6 space-y-2">
                            <li className="flex items-center"><CheckIcon /> 50 AI Headshot Credits</li>
                            <li className="flex items-center"><CheckIcon /> Multiple professional styles</li>
                            <li className="flex items-center"><CheckIcon /> High-resolution downloads</li>
                            <li className="flex items-center"><CheckIcon /> Full ownership of your images</li>
                        </ul>
                        <button 
                            onClick={handleSignIn} 
                            disabled={isAuthLoading}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-lg text-lg transition-transform transform hover:scale-105 disabled:bg-indigo-400 flex items-center justify-center">
                            {isAuthLoading ? <Spinner small /> : 'Buy Now'}
                        </button>
                    </div>
                </div>

                <div className="mt-20 max-w-3xl mx-auto" id="faq">
                     <h3 className="text-3xl font-bold mb-8">Frequently Asked Questions</h3>
                     <div className="space-y-4 text-left">
                        <details className="bg-gray-800 p-4 rounded-lg cursor-pointer">
                            <summary className="font-semibold">How does it work?</summary>
                            <p className="text-gray-400 mt-2">You upload 1-5 casual selfies. Our AI model analyzes your facial features and then generates a variety of new, professional-looking headshots in different styles and backgrounds.</p>
                        </details>
                         <details className="bg-gray-800 p-4 rounded-lg cursor-pointer">
                            <summary className="font-semibold">Who owns the generated images?</summary>
                            <p className="text-gray-400 mt-2">You do! You have full commercial rights to use your generated headshots anywhere you like.</p>
                        </details>
                         <details className="bg-gray-800 p-4 rounded-lg cursor-pointer">
                            <summary className="font-semibold">What is the quality of the photos?</summary>
                            <p className="text-gray-400 mt-2">The images are generated in high resolution, suitable for printing or for use on high-resolution displays for websites like LinkedIn.</p>
                        </details>
                     </div>
                </div>
            </main>
             <footer className="text-center py-8 text-gray-500 border-t border-gray-800 mt-12">
                <div className="space-x-4">
                    <button onClick={() => setPage('terms')} className="hover:text-gray-300">Terms of Service</button>
                    <span>&bull;</span>
                    <button onClick={() => setPage('privacy')} className="hover:text-gray-300">Privacy Policy</button>
                </div>
                <p className="mt-4">&copy; 2024 AI Headshot Generator. All Rights Reserved.</p>
            </footer>
        </div>
    );
    
    const CheckIcon = () => (
        <svg className="w-6 h-6 mr-2 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
    );

    const Dashboard = () => (
        <div className="w-full min-h-screen bg-gray-100">
            <header className="bg-white shadow-sm">
                <div className="container mx-auto px-6 py-4 flex justify-between items-center">
                    <h1 className="text-xl font-bold text-gray-800">Dashboard</h1>
                    <div className="flex items-center space-x-4">
                         <span className="font-semibold text-gray-600 hidden sm:block">{user?.email}</span>
                         <button onClick={handleSignOut} className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2 px-4 rounded-lg transition-colors">
                            Sign Out
                         </button>
                    </div>
                </div>
            </header>
            <main className="container mx-auto px-6 py-8">
                {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-6" role="alert">{error}</div>}
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Controls */}
                    <div className="lg-col-span-1 bg-white p-6 rounded-lg shadow-md space-y-6 h-fit">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-800">Your Credits</h2>
                            <div className="flex items-baseline mt-2">
                                <p className="text-5xl font-extrabold text-indigo-600">{profile?.credits ?? '...'}</p>
                                <span className="ml-2 text-gray-500">credits</span>
                            </div>
                        </div>

                        {profile?.credits < 50 && (
                            <button 
                                onClick={handleBuyCredits} 
                                disabled={isLoading}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-lg text-lg transition-colors disabled:bg-indigo-300 flex items-center justify-center">
                                {isLoading ? <Spinner small /> : 'Buy 50 Credits'}
                            </button>
                        )}

                        <div className="border-t border-gray-200 pt-6">
                             <h3 className="text-lg font-semibold text-gray-700 mb-2">1. Upload Your Selfies</h3>
                             <p className="text-sm text-gray-500 mb-4">Upload 1-5 clear photos. For best results, use a variety of angles.</p>
                             <input type="file" multiple accept="image/png, image/jpeg" onChange={handleFileChange} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"/>
                            {uploadedFiles.length > 0 && (
                                <div className="mt-4 grid grid-cols-3 gap-2">
                                    {uploadedFiles.map((file, index) => (
                                        <img key={index} src={URL.createObjectURL(file)} alt="preview" className="w-full h-auto object-cover rounded-md"/>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="border-t border-gray-200 pt-6">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-lg font-semibold text-gray-700">2. Describe Your Style</h3>
                                <button onClick={handleSuggestStyles} disabled={isTextLoading} className="text-sm text-indigo-600 hover:text-indigo-800 disabled:text-gray-400 flex items-center">
                                    {isTextLoading && styleSuggestions.length === 0 ? <Spinner small /> : '✨ Suggest Styles'}
                                </button>
                            </div>
                             <p className="text-sm text-gray-500 mb-4">"black and white, cinematic lighting" or "outdoor, natural background".</p>
                             <textarea 
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                placeholder="Enter custom style..."
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                rows="3"
                             />
                             {styleSuggestions.length > 0 && (
                                <div className="mt-2 space-y-2">
                                    {styleSuggestions.map((s, i) => (
                                        <button key={i} onClick={() => { setCustomPrompt(s.description); setStyleSuggestions([]); }} className="w-full text-left p-2 bg-indigo-50 hover:bg-indigo-100 rounded-md">
                                            <p className="font-bold text-indigo-800">{s.name}</p>
                                            <p className="text-sm text-indigo-600">{s.description}</p>
                                        </button>
                                    ))}
                                </div>
                             )}
                        </div>

                        <div className="border-t border-gray-200 pt-6">
                             <h3 className="text-lg font-semibold text-gray-700 mb-2">3. Generate Headshots</h3>
                             <p className="text-sm text-gray-500 mb-4">This will use 50 credits and generate new headshots.</p>
                             <button 
                                onClick={handleGenerate} 
                                disabled={isLoading || profile?.credits < 50 || uploadedFiles.length === 0}
                                className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg text-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center">
                                {isLoading ? <Spinner small /> : 'Generate Headshots (50 Credits)'}
                             </button>
                        </div>
                    </div>

                    {/* Right Column: Gallery & Tools */}
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white p-6 rounded-lg shadow-md">
                             <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Generated Headshots</h2>
                             {isLoading && (
                                 <div className="flex flex-col items-center justify-center h-96 text-gray-500">
                                    <Spinner large />
                                    <p className="mt-4">Generating your new headshots... this may take a minute.</p>
                                 </div>
                             )}
                             {!isLoading && generatedImages.length === 0 && (
                                 <div className="text-center py-16 px-6 border-2 border-dashed border-gray-300 rounded-lg">
                                    <h3 className="text-lg font-medium text-gray-900">Your gallery is empty</h3>
                                    <p className="mt-1 text-sm text-gray-500">Follow the steps on the left to generate your first set of headshots.</p>
                                 </div>
                             )}
                             {generatedImages.length > 0 && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                    {generatedImages.map((imgSrc, index) => (
                                        <div key={index} className="relative group">
                                            <img src={imgSrc} alt={`Generated headshot ${index + 1}`} className="w-full h-auto object-cover rounded-lg shadow-md"/>
                                            <a href={imgSrc} download={`headshot-${index + 1}.png`} className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                                                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                            </a>
                                        </div>
                                    ))}
                                </div>
                             )}
                        </div>
                        
                        {generatedImages.length > 0 && !isLoading && (
                            <div className="bg-white p-6 rounded-lg shadow-md">
                                <h2 className="text-2xl font-bold text-gray-800 mb-4">Upgrade Your Profile</h2>
                                <p className="text-gray-600 mb-4">Use your new headshot style to create a compelling LinkedIn bio.</p>
                                <button onClick={handleGenerateBio} disabled={isTextLoading} className="bg-sky-600 hover:bg-sky-500 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-sky-300 flex items-center">
                                    {isTextLoading && !linkedInBio ? <Spinner small /> : '✨ Draft my LinkedIn Bio'}
                                </button>
                                {linkedInBio && (
                                    <div className="mt-4">
                                        <textarea 
                                            readOnly 
                                            value={linkedInBio} 
                                            className="w-full p-2 border border-gray-300 rounded-md bg-gray-50" 
                                            rows="6" 
                                        />
                                        <button onClick={() => navigator.clipboard.writeText(linkedInBio)} className="mt-2 text-sm text-indigo-600 hover:text-indigo-800">
                                            Copy to Clipboard
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
    
    const Spinner = ({ small = false, large = false }) => (
        <svg className={`animate-spin ${large ? 'h-10 w-10' : small ? 'h-5 w-5 mr-2' : 'h-5 w-5'} text-white`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
    );

    // --- Page Router ---
    if (isAuthLoading) {
        return (
            <div className="w-full min-h-screen bg-gray-900 flex items-center justify-center">
                <div className="text-white text-xl flex items-center">
                    <Spinner large />
                    <span className="ml-4">Authenticating...</span>
                </div>
            </div>
        );
    }
    
    // Page routing logic based on user state
    console.log("Page routing - user:", user, "page:", page, "isAuthLoading:", isAuthLoading);
    
    if (user) {
        // If user is logged in, show the dashboard
        console.log("Routing to Dashboard - user is authenticated");
        return <Dashboard />;
    }

    // If no user, handle landing and legal pages
    console.log("Routing to landing/legal pages - no user authenticated");
    switch (page) {
        case 'privacy':
            return <PrivacyPolicy onBack={() => setPage('landing')} />;
        case 'terms':
            return <TermsOfService onBack={() => setPage('landing')} />;
        case 'landing':
        default:
            return <LandingPage />;
    }
}

export default App;