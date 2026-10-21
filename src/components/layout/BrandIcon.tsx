import { useId } from "react";

/** Логотип: рыба над волной на синей плитке (как в референсе). */
export default function BrandIcon({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a97ca" />
          <stop offset="1" stopColor="#22629c" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="98" height="98" rx="23" fill={`url(#${gradient})`} />
      <rect x="1.5" y="1.5" width="97" height="97" rx="22.5" fill="none" stroke="rgba(255,255,255,0.35)" />
      <path d="M19 51C24 40 34 34 46 35C58 36 66 44 69 50C66 57 58 65 46 65C33 65 24 61 19 51Z" fill="#f4f8ff" />
      <path d="M66 51L80.5 33V67Z" fill="#f4f8ff" strokeLinejoin="round" />
      <circle cx="34" cy="47" r="4.2" fill="#2c6fb3" />
      <path d="M13 75C20 69 27 69 33 73S46 79 52 74S66 69 72 73S84 79 90 74" fill="none" stroke="#f4f8ff" strokeWidth="4.6" strokeLinecap="round" />
    </svg>
  );
}
