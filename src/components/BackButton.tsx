// History-aware Back button. Goes to the previous in-app page when there is
// one (e.g. collection grid -> movie -> Back returns to the collection), and
// falls back to Home only when this is the first entry (direct deep-link).
//
// Uses react-router's location.key: the initial entry has key "default", so a
// non-default key means there is a real previous page to return to.

import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface BackButtonProps {
  /** Fallback destination when there is no useful history. Default "/". */
  fallback?: string;
  label?: string;
  className?: string;
}

export default function BackButton({
  fallback = "/",
  label = "Back",
  className = "btn btn--ghost media-back__btn",
}: BackButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const onClick = useCallback(() => {
    if (location.key && location.key !== "default") {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }, [navigate, location.key, fallback]);

  return (
    <button type="button" className={className} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {label}
    </button>
  );
}
