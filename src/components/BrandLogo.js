import Image from "next/image";
export default function BrandLogo({ full = false }) {
  return (
    <Image
      className={full ? "tepsy-logo tepsy-logo-full" : "tepsy-logo"}
      src={full ? "/brand/logo.png" : "/brand/mark.png"}
      width={full ? 240 : 40}
      height={full ? 100 : 40}
      alt="Tepsy"
      unoptimized
    />
  );
}
