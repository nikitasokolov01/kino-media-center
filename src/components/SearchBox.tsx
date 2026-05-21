// Sidebar search input.
// Submitting navigates to /search?q=<encoded>. The input stays in sync with
// the URL so going back/forward updates what's shown in the box.

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function SearchBox() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [value, setValue] = useState(urlQuery);

  // Sync local input value when the URL's `q` changes (e.g. back/forward,
  // or another component linking to a saved search).
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form className="search-box" role="search" onSubmit={onSubmit}>
      <input
        type="search"
        className="search-box__input"
        placeholder="Search movies & series"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-label="Search"
      />
    </form>
  );
}
