type LogoProps = {
  size?: "default" | "large";
};

export function Logo({ size = "default" }: LogoProps) {
  const dimensions = size === "large" ? "w-16 h-16" : "w-10 h-10";

  return (
    <div className={`${dimensions} flex items-center justify-center`}>
      <svg
        viewBox="0 0 48 46"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <path
          d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
          className="fill-primary-600 dark:fill-primary-400"
        />
      </svg>
    </div>
  );
}
