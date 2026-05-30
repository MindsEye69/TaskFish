"use client";
import { useState, useEffect } from "react";

interface Props {
  name: string;
  className?: string;
  fallbackSize?: number;
  onIconError: () => void;
  isSystem: boolean;
}

export default function IconImage({ name, className, onIconError, isSystem }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (window.electron) {
      window.electron.getIcon(name).then((data) => {
        if (data === "NO_ICON" || !data) {
          onIconError();
        } else {
          setSrc(`data:image/png;base64,${data}`);
        }
      });
    } else {
      setSrc(`/api/icon?name=${encodeURIComponent(name)}`);
    }
  }, [name]);

  if (!src) return null;

  return (
    <img
      src={src}
      className={className}
      alt=""
      onError={onIconError}
    />
  );
}
