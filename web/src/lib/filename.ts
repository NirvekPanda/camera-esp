const pad = (n: number) => String(n).padStart(2, "0");

/** YYYYMMDD-HHMMSS.jpg: FAT32-safe and sorts chronologically. */
export function photoName(d: Date): string {
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}-${time}.jpg`;
}

/** Duplicate suffix for photos taken in the same second: _02, _03, ... (padded so _10 sorts after _09). */
export const duplicateName = (name: string, n: number) =>
  name.replace(".jpg", `_${String(n).padStart(2, "0")}.jpg`);

/**
 * Newest first, like the camera's LIST (ui::newerPhoto): dated YYYYMMDD-HHMMSS names by time, then
 * undated ones (IMG_0001.jpg). Plain code-unit order, not localeCompare: ICU collation sorts "_"
 * before ".", which would put 142305_02.jpg ahead of its original.
 */
export const newestFirst = <T extends { name: string }>(files: T[]) =>
  [...files].sort((a, b) => {
    const dated = Number(parsePhotoDate(b.name) !== null) - Number(parsePhotoDate(a.name) !== null);
    return dated || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0);
  });

const PHOTO_DATE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/;

export function parsePhotoDate(name: string): Date | null {
  const match = PHOTO_DATE.exec(name);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}
