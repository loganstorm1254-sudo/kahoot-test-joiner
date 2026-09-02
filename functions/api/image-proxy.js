import * as imageProxy from "../../api/image-proxy.js";

export async function OPTIONS() {
  return imageProxy.OPTIONS();
}

export async function GET(context) {
  return imageProxy.GET(context.request);
}
