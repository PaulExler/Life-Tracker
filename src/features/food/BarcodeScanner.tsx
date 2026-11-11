import { useEffect, useRef, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
const Detector: any = (globalThis as any).BarcodeDetector

export const canScan = !!Detector && !!navigator.mediaDevices?.getUserMedia

/** Full-screen camera view that reports the first EAN/UPC barcode it sees. */
export function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let stop = false
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!video.current) return
        video.current.srcObject = stream
        await video.current.play()
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => [])
          if (codes.length) {
            stop = true
            onCode(codes[0].rawValue)
            return
          }
          await new Promise((r) => setTimeout(r, 250))
        }
      } catch {
        setErr('Camera not available — type the barcode number instead.')
      }
    })()
    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onCode])

  return (
    <div className="scanner" role="dialog" aria-label="Scan barcode">
      <video ref={video} playsInline muted />
      <div className="scanner-frame" />
      <div className="scanner-bar">
        <span>{err ?? 'Point the camera at the barcode'}</span>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
