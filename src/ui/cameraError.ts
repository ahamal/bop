// Turn a getUserMedia / model-load failure into a short, human message.
// Shared by every camera screen (play, arcade) — lives on its own so the
// arcade doesn't depend on PlayScreen.

export function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Camera access was blocked. Allow it in your browser and try again.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "No camera was found on this device.";
      case "NotReadableError":
        return "The camera is in use by another app.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong starting the camera.";
}
