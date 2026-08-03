import Image from "next/image";
import CardArt from "./CardArt";
import type { Game } from "@/lib/types";

// Real uploaded photo when one exists (CLAUDE.md §6.13), the gradient
// placeholder otherwise — never both, and never a fake photo.
export default function ListingImage({
  src,
  game,
  label,
}: {
  src?: string;
  game: Game;
  label: string;
}) {
  if (src) {
    // bg-white so a photo with alpha transparency (a card scan cut out
    // from its background, say) never shows whatever's behind this
    // component through it — a dark hero background turning a "see-through"
    // card into a rendering bug, not a stylistic choice.
    return (
      <div className="relative h-full w-full bg-white">
        <Image src={src} alt={label} fill className="object-cover" />
      </div>
    );
  }
  return (
    <div className="h-full w-full">
      <CardArt game={game} label={label} />
    </div>
  );
}
