import { LoginButton } from "../auth/LoginButton";
import { Logo } from "../layout/Logo";
import { ThemeToggle } from "../layout/ThemeToggle";

export function LandingPage() {
  return (
    <div className="relative flex-1 flex flex-col items-center justify-center px-4
      bg-gradient-to-br from-primary-50 via-white to-primary-100
      dark:from-gray-950 dark:via-gray-900 dark:to-primary-950">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>

      <div className="max-w-2xl mx-auto text-center">
        <div className="flex justify-center mb-8">
          <Logo size="large" />
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6
          tracking-tight leading-tight">
          Summarize text.
          <br />
          <span className="text-primary-600 dark:text-primary-400">Transcribe speech.</span>
        </h1>

        <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-300 mb-10 max-w-lg mx-auto leading-relaxed">
          Upload documents, audio, or video files and get instant AI-powered
          summaries and transcriptions.
        </p>

        <LoginButton size="large" />

        <div className="mt-16 grid grid-cols-3 gap-8 text-center">
          <div>
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center">
              <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Text Files</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">.txt, .md, and more</p>
          </div>

          <div>
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center">
              <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Audio</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">MP3, WAV, M4A</p>
          </div>

          <div>
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center">
              <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Video</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">MP4, WebM</p>
          </div>
        </div>
      </div>
    </div>
  );
}
