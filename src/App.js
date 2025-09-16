import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    onAuthStateChanged, 
    signInWithRedirect,
    getRedirectResult,
    GoogleAuthProvider,
    signOut
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
// This configuration is a placeholder. In a real environment, these would be securely managed.
const firebaseConfig = {
    apiKey: process.env.REACT_APP_API_KEY,
    authDomain: process.env.REACT_APP_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_PROJECT_ID,
    storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_APP_ID,
    measurementId: process.env.REACT_APP_MEASUREMENT_ID
};

// --- Firebase Initialization ---
// NOTE: For the live environment, __firebase_config is injected.
// Declare __firebase_config at the top to avoid use-before-define errors
// eslint-disable-next-line no-var
var __firebase_config;

const app = initializeApp(typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Main App Component ---
function App() {
    const [page, setPage] = useState('landing');
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [uploadedFiles, setUploadedFiles] = useState([]);
    const [generatedImages, setGeneratedImages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isTextLoading, setIsTextLoading] = useState(false); // For Gemini text features
    const [error, setError] = useState('');
    const [customPrompt, setCustomPrompt] = useState('');
    const [styleSuggestions, setStyleSuggestions] = useState([]);
    const [linkedInBio, setLinkedInBio] = useState('');


    // --- Authentication Effect ---
    useEffect(() => {
        // Handle the result of the redirect authentication
        getRedirectResult(auth)
            .catch((error) => {
                setError(error.message);
                console.error("Auth redirect error:", error);
            });

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                setPage('dashboard');
            } else {
                setUser(null);
                setPage('landing');
                setProfile(null);
                setGeneratedImages([]);
            }
        });
        return () => unsubscribe();
    }, []);

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
            // To avoid duplicates and show newest first
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
        const apiKey = ""; // Canvas provides this
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
        const provider = new GoogleAuthProvider();
        signInWithRedirect(auth, provider).catch((error) => setError(error.message));
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
        setLinkedInBio(''); // Clear previous bio

        try {
            const profileRef = doc(db, 'profiles', user.uid);
            await updateDoc(profileRef, { credits: profile.credits - 50 });

            const imagePromises = uploadedFiles.map(file => toBase64(file));
            const base64Images = await Promise.all(imagePromises);
            
            const generated = [];
            
            for (const base64Image of base64Images) {
                 const apiKey = "";
                 const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`;

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
    const LandingPage = () => (
        <div className="w-full min-h-screen bg-gray-900 text-white">
            <header className="container mx-auto px-6 py-4 flex justify-between items-center">
                <h1 className="text-2xl font-bold">AI Headshot Generator</h1>
                <button onClick={handleSignIn} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                    Login / Get Started
                </button>
            </header>
            <main className="container mx-auto px-6 text-center pt-24 pb-12">
                <h2 className="text-5xl md:text-6xl font-extrabold leading-tight mb-4">
                    Studio-Quality Headshots. <br />Generated in Minutes.
                </h2>
                <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
                    Upload your selfies, and let our AI create professional headshots for your LinkedIn, website, or resume. No photoshoot required.
                </p>
                <button onClick={handleSignIn} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-lg text-lg transition-transform transform hover:scale-105">
                    Get Your Headshots Now
                </button>

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
                        <button onClick={handleSignIn} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-lg text-lg transition-transform transform hover:scale-105">
                            Buy Now
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
                <p>&copy; 2024 AI Headshot Generator. All Rights Reserved.</p>
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
                    <div className="lg:col-span-1 bg-white p-6 rounded-lg shadow-md space-y-6 h-fit">
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
    switch (page) {
        case 'dashboard':
            return <Dashboard />;
        case 'landing':
        default:
            return <LandingPage />;
    }
}

export default App;