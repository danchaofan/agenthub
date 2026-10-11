import type React from 'react';
export function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    chat: <path d="M4 5h16v12H9l-5 4V5z" />,
    grid: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
    arrow: <path d="m7 11 5-5 5 5M12 6v13" />,
    folder: <path d="M3 6h7l2 3h9v11H3V6z" />,
    check: <path d="m5 12 4 4L19 6" />,
    panel: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </>
    ),
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.chat}
    </svg>
  );
}
