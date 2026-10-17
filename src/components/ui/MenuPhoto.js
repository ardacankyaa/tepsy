"use client";
import { useState } from "react";
import { ImageOff } from "lucide-react";
import { isAllowedMenuImageUrl } from "@/lib/menu-input.cjs";
import "@/styles/menu-photos.css";

function Photo({ src, name, className }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`menu-photo ${className || ""}`}>
      {!failed && isAllowedMenuImageUrl(src) ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="menu-photo-placeholder" role="img" aria-label={name}>
          <ImageOff aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export default function MenuPhoto({ src, name, className }) {
  return src ? <Photo key={src} src={src} name={name} className={className} /> : null;
}
