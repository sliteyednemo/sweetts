
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

const App = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [description, setDescription] = useState('');
    const [error, setError] = useState('');
    const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    // Initialize Gemini AI, assuming API_KEY is in the environment variables
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // --- Local TTS as a fallback ---
    const speakLocally = (text: string) => {
        if (!text) return;
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            if (voice) {
                utterance.voice = voice;
            }
            utterance.lang = 'id-ID';
            utterance.onerror = (event) => {
                console.error("Local SpeechSynthesisUtterance.onerror", event);
                setError("Gagal mengucapkan deskripsi. Fitur suara mungkin tidak didukung.");
            };
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.error("Error with local speech synthesis:", e);
            setError("Fitur suara tidak tersedia di browser ini.");
        }
    };

    // --- Primary TTS using Google Translate ---
    const speak = (text: string) => {
        if (!text) {
            console.warn("Speak function called with empty text.");
            return;
        }
        
        // Cancel any previous speech synthesis
        window.speechSynthesis.cancel();
        
        const audio = audioRef.current;
        if (!audio) {
            console.warn("Audio element not available, falling back to local TTS.");
            speakLocally(text);
            return;
        }

        const onErrorHandler = () => {
            console.error("Error loading Google Translate TTS audio. Falling back to local voice.");
            speakLocally(text);
        };
        
        // Add a one-time listener for the error event on the audio element
        audio.addEventListener('error', onErrorHandler, { once: true });
        
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=id-ID&client=tw-ob`;
        audio.src = url;
        
        // Attempt to play the audio
        audio.play().catch(error => {
            console.error("Audio play promise rejected, falling back to local TTS:", error);
            // If play() is rejected, the 'error' event might not have fired.
            // We must remove the listener to prevent a double-call and then call the fallback.
            audio.removeEventListener('error', onErrorHandler);
            speakLocally(text);
        });
    };

    // Setup camera and TTS voices on component mount
    useEffect(() => {
        // --- Voice Setup for local fallback ---
        const loadVoices = () => {
            const availableVoices = window.speechSynthesis.getVoices();
            const indonesianVoice = availableVoices.find(v => v.lang === 'id-ID') || availableVoices.find(v => v.lang.startsWith('id'));
            if (indonesianVoice) {
                setVoice(indonesianVoice);
            }
        };

        window.speechSynthesis.onvoiceschanged = loadVoices;
        loadVoices(); // Also call it directly in case voices are already available

        // --- Camera Setup ---
        async function setupCamera() {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    // Request camera with preference for the rear camera
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'environment' }
                    });
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                    }
                } catch (err) {
                    console.error("Error accessing camera:", err);
                    const errorMessage = "Tidak dapat mengakses kamera. Silakan periksa izin browser Anda.";
                    setError(errorMessage);
                    speak(errorMessage);
                }
            } else {
                 const errorMessage = "Browser Anda tidak mendukung akses kamera.";
                 setError(errorMessage);
                 speak(errorMessage);
            }
        }
        setupCamera();

        // --- Cleanup ---
        return () => {
            // Stop video stream when component unmounts
            if (videoRef.current && videoRef.current.srcObject) {
                const stream = videoRef.current.srcObject as MediaStream;
                stream.getTracks().forEach(track => track.stop());
            }
            // Stop any playing speech on unmount
            window.speechSynthesis.cancel();
            window.speechSynthesis.onvoiceschanged = null;
        };
    }, []);

    const captureAndDescribe = async () => {
        if (isLoading) return;

        setIsLoading(true);
        setDescription('');
        setError('');
        speak("Menganalisis...");

        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video && canvas && video.readyState >= 2) { // Ensure video has enough data
            const context = canvas.getContext('2d');
            if (context) {
                // Set canvas dimensions to match video to capture full frame
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Convert canvas to base64 JPEG
                const dataUrl = canvas.toDataURL('image/jpeg');
                const base64Data = dataUrl.split(',')[1];

                try {
                    const imagePart = {
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: base64Data,
                        },
                    };
                    
                    const textPart = {
                         text: "Jelaskan gambar ini dalam satu atau dua kalimat singkat untuk orang tunanetra dalam Bahasa Indonesia. Prioritaskan penyebutan jumlah uang atau rintangan."
                    };

                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: { parts: [imagePart, textPart] },
                    });

                    const resultText = response.text;
                    setDescription(resultText);
                    speak(resultText);

                } catch (err) {
                    console.error("Error with Gemini API:", err);
                    const errorMessage = "Maaf, saya tidak dapat mendeskripsikan gambar. Silakan coba lagi.";
                    setError(errorMessage);
                    speak(errorMessage);
                }
            }
        } else {
             const errorMessage = "Kamera belum siap. Mohon tunggu sejenak dan coba lagi.";
             setError(errorMessage);
             speak(errorMessage);
        }
        setIsLoading(false);
    };
    
    // CSS-in-JS for styling the application
    const styles: { [key: string]: React.CSSProperties } = {
        container: {
            width: '100%',
            height: '100%',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#000',
        },
        video: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 1,
        },
        overlay: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '20px',
            boxSizing: 'border-box',
            background: 'linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0))',
        },
        button: {
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            backgroundColor: '#fff',
            border: '5px solid rgba(0,0,0,0.5)',
            boxShadow: '0 0 15px rgba(0,0,0,0.7)',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#000',
            marginBottom: '20px',
            transition: 'transform 0.1s ease, background-color 0.2s',
        },
        buttonDisabled: {
            backgroundColor: '#888',
            cursor: 'not-allowed',
        },
        descriptionBox: {
            width: '100%',
            maxHeight: '100px',
            overflowY: 'auto',
            color: '#fff',
            textAlign: 'center',
            fontSize: '18px',
            lineHeight: '1.4',
            textShadow: '1px 1px 3px black',
            padding: '0 10px',
            boxSizing: 'border-box',
        },
        spinner: {
            border: '5px solid rgba(0, 0, 0, 0.2)',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            borderLeftColor: '#007bff',
            animation: 'spin 1s linear infinite',
        },
    };

    return (
        <div style={styles.container}>
            <style>
                {`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .capture-button:active {
                        transform: scale(0.95);
                    }
                `}
            </style>
            <video ref={videoRef} autoPlay playsInline muted style={styles.video} aria-hidden="true"></video>
            <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
            <audio ref={audioRef} style={{ display: 'none' }} aria-hidden="true" />

            <div style={styles.overlay}>
                 <button
                    className="capture-button"
                    onClick={captureAndDescribe}
                    disabled={isLoading}
                    style={{
                        ...styles.button,
                        ...(isLoading ? styles.buttonDisabled : {})
                    }}
                    aria-label="Analisis gambar"
                >
                    {isLoading ? <div style={styles.spinner}></div> : "Sentuh"}
                </button>
                 <div style={styles.descriptionBox} aria-live="polite">
                    {description || error}
                </div>
            </div>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
