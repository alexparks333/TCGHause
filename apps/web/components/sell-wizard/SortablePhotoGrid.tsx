"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Upload, X, Plus, GripVertical } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { uploadListingPhoto, deleteListingPhoto } from "@/lib/storage";

const MAX_PHOTOS = 10;
const ACCEPT = "image/jpeg,image/png,image/webp";
const ACCEPTED_TYPES = ACCEPT.split(",");

interface PhotoItem {
  // Stable across the temp-preview -> final-URL swap, so dnd-kit's
  // sortable identity (and React's key) never changes mid-upload — url
  // itself can't be used as the id the way a settled-only list could,
  // since it's a blob: URL until the upload resolves.
  id: string;
  url: string;
  uploading: boolean;
}

function urlToId(url: string, i: number) {
  return `existing-${i}-${url}`;
}

export default function SortablePhotoGrid({
  photos,
  onChange,
  externalPhotos,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  // Photo URLs that arrived via PhoneUploadPanel's QR handoff — already
  // uploaded (by apps/api/internal/photosession, not uploadListingPhoto),
  // so they're merged in as already-settled tiles, not queued through
  // addFiles. Kept as a reconciliation against `items` (append whatever's
  // new, capped at MAX_PHOTOS) rather than replacing the list outright, so
  // this stays additive to whatever's already here from drag-and-drop.
  externalPhotos?: string[];
}) {
  const [items, setItems] = useState<PhotoItem[]>(() =>
    photos.map((url, i) => ({ id: urlToId(url, i), url, uploading: false })),
  );
  const [notice, setNotice] = useState("");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  // A plain counter (not boolean) because dragenter/dragleave fire once
  // per child element crossed, not once per the container as a whole —
  // without depth-counting, the highlight would flicker off every time
  // the pointer passes over a grid tile mid-drag.
  const dragDepth = useRef(0);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    // A small activation distance so a plain click (e.g. missing the
    // remove button by a pixel) doesn't get misread as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // The single place that notifies the parent (SellWizard's WizardData)
  // of the settled photo list — every mutation below just calls setItems,
  // this effect is what propagates it outward. Calling onChange directly
  // from inside a setItems updater (the previous version of this file did,
  // for the async upload-complete case) triggers React's "Cannot update a
  // component while rendering a different component" warning: updater
  // functions must stay pure, and onChange itself calls the parent's own
  // setState. Deliberately keyed only on `items`, not `onChange` — the
  // parent passes a fresh inline function every render, and re-notifying
  // it with the same list on every one of its own re-renders would just
  // be wasted work, not a correctness issue.
  useEffect(() => {
    onChange(items.filter((i) => !i.uploading).map((i) => i.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // No crop step — every selected/dropped photo shows up immediately (its
  // own local preview + a spinner) and uploads in parallel, straight to
  // storage as-is. There used to be a mandatory per-photo crop modal here;
  // deliberately removed, not just skipped for the bulk case.
  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (files.length === 0) return;

    const remaining = MAX_PHOTOS - items.length;
    if (remaining <= 0) {
      setNotice(`You can upload up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const accepted = files.slice(0, remaining);
    setNotice(
      accepted.length < files.length
        ? `Only added ${accepted.length} of ${files.length} — ${MAX_PHOTOS} photo max.`
        : "",
    );

    const ids = accepted.map(() => `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setItems((prev) => [
      ...prev,
      ...accepted.map((file, i) => ({ id: ids[i], url: URL.createObjectURL(file), uploading: true })),
    ]);

    accepted.forEach((file, i) => {
      const tempId = ids[i];
      uploadListingPhoto(file)
        .then((uploadedUrl) => {
          setItems((prev) =>
            prev.map((it) => (it.id === tempId ? { ...it, url: uploadedUrl, uploading: false } : it)),
          );
        })
        .catch((err) => {
          setNotice(err instanceof Error ? err.message : "One photo failed to upload — try again.");
          setItems((prev) => prev.filter((it) => it.id !== tempId));
        });
    });
  }

  // Every URL ever merged in from PhoneUploadPanel's poll, even after the
  // user removes it from `items` — PhoneUploadPanel polls the session's
  // FULL photo list (apps/api/internal/photosession never forgets a photo
  // just because the desktop grid did), so comparing new poll results
  // against current `items` alone would resurrect a just-removed phone
  // photo on the very next poll. This ref is what makes a removal stick
  // for the rest of this component's lifetime, independent of polling.
  const offeredExternalUrls = useRef(new Set<string>());

  // Merges in any URL from PhoneUploadPanel's poll that hasn't been offered
  // before — same MAX_PHOTOS cap addFiles enforces, so scanning and
  // snapping more phone photos than fit can't silently blow past the limit.
  //
  // Deliberately NOT a useEffect: React's own guidance ("adjusting state
  // when a prop changes") is to compare against the previous prop value and
  // call setState directly in the render body when it changes, rather than
  // in an effect — an effect here would run a render, commit, THEN run the
  // effect and trigger a second render, which is exactly the "cascading
  // renders" pattern React's set-state-in-effect lint rule flags. This
  // form still only updates state (and re-renders once more) when
  // `externalPhotos` actually changes, same end result, no extra effect.
  const [prevExternalPhotos, setPrevExternalPhotos] = useState(externalPhotos);
  if (externalPhotos !== prevExternalPhotos) {
    setPrevExternalPhotos(externalPhotos);
    if (externalPhotos && externalPhotos.length > 0) {
      setItems((prev) => {
        const newUrls = externalPhotos.filter((url) => !offeredExternalUrls.current.has(url));
        const remaining = MAX_PHOTOS - prev.length;
        if (newUrls.length === 0 || remaining <= 0) return prev;
        const toAdd = newUrls.slice(0, remaining);
        toAdd.forEach((url) => offeredExternalUrls.current.add(url));
        return [
          ...prev,
          ...toAdd.map((url, i) => ({ id: urlToId(url, prev.length + i), url, uploading: false })),
        ];
      });
    }
  }

  function handleRemove(id: string) {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    if (!target.uploading) deleteListingPhoto(target.url).catch(() => {});
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setItems((prev) => arrayMove(prev, oldIndex, newIndex));
  }

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;
  const canAddMore = items.length < MAX_PHOTOS;

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current += 1;
          setIsDraggingFiles(true);
        }}
        onDragLeave={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDraggingFiles(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setIsDraggingFiles(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`relative rounded-2xl transition-colors ${
          isDraggingFiles ? "bg-brand-navy/5 ring-2 ring-brand-navy" : ""
        }`}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-brand-navy/5">
            <span className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-lg">
              Drop to add photos
            </span>
          </div>
        )}

        {items.length === 0 ? (
          <label className="flex aspect-[16/9] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 transition-colors hover:border-brand-navy hover:bg-brand-surface">
            <Upload size={32} className="text-gray-400" />
            <p className="text-sm font-medium text-gray-600">Drag photos here or click to browse</p>
            <p className="text-xs text-gray-400">Up to {MAX_PHOTOS} photos · JPEG, PNG, or WebP</p>
            <input
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {items.map((item, i) => (
                  <SortableTile
                    key={item.id}
                    item={item}
                    isCover={i === 0}
                    position={i + 1}
                    onRemove={() => handleRemove(item.id)}
                  />
                ))}

                {canAddMore && (
                  <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-brand-navy hover:bg-brand-surface hover:text-brand-navy">
                    <Plus size={22} />
                    <span className="text-xs font-medium">Add photos</span>
                    <input
                      type="file"
                      accept={ACCEPT}
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeItem ? (
                <div className="relative aspect-[4/5] w-full scale-105 overflow-hidden rounded-xl border-2 border-brand-navy bg-white shadow-2xl">
                  <Image src={activeItem.url} alt="" fill className="object-cover" />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {notice && <p className="text-xs text-brand-urgent">{notice}</p>}
      {items.length > 0 && (
        <p className="text-xs text-gray-400">
          Drag to reorder — the first photo is the cover photo shown everywhere on the site.
        </p>
      )}
    </div>
  );
}

function SortableTile({
  item,
  isCover,
  position,
  onRemove,
}: {
  item: PhotoItem;
  isCover: boolean;
  position: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: item.uploading,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      // The whole tile is the drag surface (not just a small handle) —
      // dnd-kit's PointerSensor only starts a drag once the pointer moves
      // past its activation distance (see the sensor config above), so a
      // plain stationary click still reaches the remove button below
      // untouched; a `pointerdown` stopPropagation on that button is the
      // extra belt-and-suspenders guard against a drag ever starting on it.
      {...(item.uploading ? {} : attributes)}
      {...(item.uploading ? {} : listeners)}
      className={`group relative aspect-[4/5] touch-none overflow-hidden rounded-xl border-2 bg-white transition-shadow ${
        item.uploading ? "" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "z-20 border-brand-navy opacity-40" : "border-gray-300"}`}
    >
      <Image src={item.url} alt={`Photo ${position}`} fill className="object-cover" />

      {item.uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-navy border-t-transparent" />
        </div>
      )}

      {isCover && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-brand-navy px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
          Cover
        </span>
      )}
      {!isCover && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] font-semibold text-white">
          {position}
        </span>
      )}

      {!item.uploading && (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
            aria-label={`Remove photo ${position}`}
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
          >
            <X size={13} />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/50 to-transparent py-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <GripVertical size={13} />
          </div>
        </>
      )}
    </div>
  );
}
