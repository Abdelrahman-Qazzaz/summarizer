import { authLoginUrl } from "../../config";

type LoginButtonProps = {
  size?: "default" | "large";
};

export function LoginButton({ size = "default" }: LoginButtonProps) {
  const sizeClasses =
    size === "large"
      ? "px-8 py-4 text-lg"
      : "px-6 py-2.5 text-sm";

  return (
    <a
      href={authLoginUrl()}
      className={`inline-flex items-center justify-center font-semibold text-white
        bg-primary-600 hover:bg-primary-700 active:bg-primary-800
        rounded-xl shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30
        transition-all duration-200 ease-out
        focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950
        ${sizeClasses}`}
    >
      Get Started
    </a>
  );
}
