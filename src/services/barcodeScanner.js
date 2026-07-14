// Barcode detection, mirroring the same "native API first, open-source fallback"
// pattern already used for OCR (see readNutritionTextFromImage in App.jsx):
// the native BarcodeDetector (Shape Detection API) is fast and hardware-accelerated
// where it exists, but it is Chrome/Android-only — Safari and therefore every
// browser on iOS never implements it. @zxing/browser (MIT-licensed, pure JS/TS port
// of the ZXing barcode library) covers those browsers so barcode scanning isn't
// silently unavailable for a large share of phones.
//
// A barcode match is the single most reliable food-identification signal this app
// can get — it names an exact product, not a visual guess — which is why it's
// worth adding as its own detection path rather than folding into the vision/OCR
// heuristics.

let zxingReaderPromise = null;

async function getZxingReader() {
  if (!zxingReaderPromise) {
    zxingReaderPromise = (async () => {
      const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const hints = new Map();
      // Retail food packaging uses these symbologies; restricting to them (rather than
      // also trying QR/Aztec/PDF417/Datamatrix on every frame) keeps each decode attempt fast.
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

let nativeDetectorInstance = null;

/**
 * Detects a product barcode from a canvas frame. Returns the raw barcode string
 * (digits only) or '' if no barcode is visible in this frame — which is the normal,
 * expected result on most calls, not an error.
 */
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
      // Fall through to the zxing fallback below.
    }
  }

  try {
    const reader = await getZxingReader();
    const result = reader.decodeFromCanvas(canvas);
    return String(result?.getText?.() || '').replace(/\D/g, '');
  } catch {
    // NotFoundException/ChecksumException/FormatException just mean "no barcode
    // in this frame" — the normal case on almost every tick of the scan loop.
    return '';
  }
}
