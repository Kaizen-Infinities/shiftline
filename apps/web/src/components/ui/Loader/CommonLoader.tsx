import React from "react";

interface CommonLoaderProps {
  text: string;
  fullScreen?: boolean;
}

const CommonLoader: React.FC<CommonLoaderProps> = ({ text, fullScreen = true }) => {
  return (
    <div
      role="status"
      className={`relative flex items-center justify-center ${
        fullScreen ? "min-h-screen w-full" : "flex-1 min-h-[250px] w-full py-10"
      }`}
    >
      <p className="text-sm sm:text-base font-semibold tracking-wide text-ink-muted animate-pulse">
        {text}
      </p>
    </div>
  );
};

export default CommonLoader;
