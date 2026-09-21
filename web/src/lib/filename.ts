const pad = (n: number) => String(n).padStart(2, "0");

/** YYYYMMDD-HHMMSS.jpg: FAT32-safe and sorts chronologically. */
export function photoName(d: Date): string {
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}-${time}.jpg`;
}

const PHOTO_DATE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/;

export function parsePhotoDate(name: string): Date | null {
  const match = PHOTO_DATE.exec(name);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}
