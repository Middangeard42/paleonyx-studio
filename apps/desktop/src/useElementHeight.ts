import { useEffect, useState } from "react";

/**
 * The current height of an element, kept up to date as it changes.
 *
 * Returns a callback ref rather than an object ref: the element it is
 * attached to may not exist yet, or may come and go (the column is not on
 * screen while the Models view is), and an object ref would never notice
 * it appear. The height is 0 until the element has been measured.
 */
export function useElementHeight(): readonly [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!element) return;
    setHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, height] as const;
}
