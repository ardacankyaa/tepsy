"use client";
import Image from "next/image";
import { useState } from "react";
import { useApp } from "@/lib/AppContext";
export default function RestaurantIdentity({ name, logoUrl }) {
  const { restaurantName, restaurantLogoUrl, lang } = useApp();
  const [failedUrl, setFailedUrl] = useState(null);
  const label = (name || restaurantName || "").trim();
  const initial = Array.from(label)[0]?.toLocaleUpperCase(lang === "tr" ? "tr-TR" : "en-US") || "?";
  const imageUrl = logoUrl === undefined ? restaurantLogoUrl : logoUrl;
  const valid =
    typeof imageUrl === "string" &&
    /^\/api\/public\/menu-images\/[a-f0-9]{64}\.webp$/.test(imageUrl);
  return (
    <span
      className="restaurant-identity"
      role="img"
      aria-label={label || (lang === "tr" ? "Restoran" : "Restaurant")}
    >
      {valid && failedUrl !== imageUrl ? (
        <Image
          className="restaurant-identity-logo"
          src={imageUrl}
          width={36}
          height={36}
          alt=""
          unoptimized
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
