let zxingReaderPromise = null;

async function getZxingReader() {
  if (!zxingReaderPromise) {
    zxingReaderPromise = (async () => {
      const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
      ]);
      return new BrowserMultiFormatReader(hints);
    })();
  }
  return zxingReaderPromise;
}

let nativeDetectorSupportChecked = false;
let nativeDetectorSupported = false;
let nativeDetectorInstance = null;

async function isNativeBarcodeDetectorSupported() {
  if (nativeDetectorSupportChecked) return nativeDetectorSupported;
  nativeDetectorSupportChecked = true;
  if (!('BarcodeDetector' in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    nativeDetectorSupported = Array.isArray(formats) && formats.length > 0;
  } catch {
    nativeDetectorSupported = false;
  }
  return nativeDetectorSupported;
}

export async function detectBarcodeFromCanvas(canvas) {
  if (!canvas) return '';
  if (await isNativeBarcodeDetectorSupported()) {
    try {
      if (!nativeDetectorInstance) {
        nativeDetectorInstance = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
        });
      }
      const results = await nativeDetectorInstance.detect(canvas);
      const value = String(results?.[0]?.rawValue || '').replace(/\D/g, '');
      if (value) return value;
    } catch {
      // ZXing fallback below.
    }
  }

  try {
    const reader = await getZxingReader();
    const result = reader.decodeFromCanvas(canvas);
    return String(result?.getText?.() || '').replace(/\D/g, '');
  } catch {
    return '';
  }
}
