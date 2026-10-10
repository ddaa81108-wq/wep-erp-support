const isMobile = () => window.matchMedia('(max-width: 700px)').matches;

type CaptureResult = 'shared' | 'copied' | 'downloaded' | 'cancelled';

export async function captureMasraweyaSummary(
  element: HTMLElement,
  businessDate: string,
): Promise<CaptureResult> {
  try {
    const canvasModule = await import('html2canvas');
    const renderCanvas = (canvasModule.default ?? canvasModule) as unknown as (
      target: HTMLElement,
      options: Record<string, unknown>,
    ) => Promise<HTMLCanvasElement>;
    const canvas = await renderCanvas(element, {
      backgroundColor: '#ffffff',
      scale: Math.min(5, Math.max(3, window.devicePixelRatio * 2)),
      useCORS: true,
      logging: false,
    });
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result: Blob | null) => (result ? resolve(result) : reject(new Error('PNG'))),
        'image/png',
        1,
      ),
    );
    const file = new File([blob], `masraweya-${businessDate}.png`, { type: 'image/png' });

    if (isMobile() && navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'ملخص المصراوية' });
      return 'shared';
    }
    if (!isMobile() && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return 'downloaded';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    throw error;
  }
}

export function captureResultMessage(result: CaptureResult) {
  if (result === 'shared') return 'تم فتح المشاركة بالصورة عالية الجودة.';
  if (result === 'copied') return 'تم نسخ صورة الجدول بأعلى جودة.';
  if (result === 'cancelled') return 'تم إلغاء المشاركة.';
  return 'تم تنزيل الصورة لأن النسخ أو المشاركة غير متاح في هذا المتصفح.';
}

export function usesMobileSharing() {
  return isMobile();
}
