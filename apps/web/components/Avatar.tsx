import Image from "next/image";

export default function Avatar({
  src,
  label,
  size = 32,
}: {
  src?: string | null;
  label: string;
  size?: number;
}) {
  if (src) {
    return (
      <Image
        src={src}
        alt={label}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-navy font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}
