import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const REPORT_KINDS = { fakta: 'Fakta keliru', tafsir: 'Analisis berlebihan', bahasa: 'Salah ketik/bahasa', lainnya: 'Lainnya' } as const;
export interface Report { digestId: string; kind: keyof typeof REPORT_KINDS; note: string; at: string }

/** Laporan kesalahan pembaca, disimpan sebagai JSON Lines agar mudah dibaca dengan `cat`. */
export class ReportLog {
  private readonly file: string;
  private readonly recent = new Map<string, number[]>();
  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) { this.file = path.join(dataDir, 'laporan.jsonl'); }
  /** false bila pengirim melewati batas 5 laporan per jam atau arsip sudah penuh. */
  async add(report: Omit<Report, 'at'>, sender: string): Promise<boolean> {
    const time = this.now().getTime();
    const sent = (this.recent.get(sender) ?? []).filter(at => time - at < 3_600_000);
    if (sent.length >= 5) return false;
    this.recent.set(sender, [...sent, time]);
    if (this.recent.size > 5000) this.recent.clear();
    await mkdir(path.dirname(this.file), { recursive: true });
    const size = await stat(this.file).then(info => info.size, () => 0);
    if (size > 2_000_000) return false;
    await appendFile(this.file, JSON.stringify({ ...report, at: new Date(time).toISOString() }) + '\n', { mode: 0o600 });
    console.info(`Laporan kesalahan ${report.digestId}: ${REPORT_KINDS[report.kind]}`);
    return true;
  }
}
