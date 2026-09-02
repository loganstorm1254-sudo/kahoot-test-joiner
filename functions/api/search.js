import * as search from "../../api/search.js";

export async function onRequestOptions() {
  return search.OPTIONS();
}

export async function onRequestGet(context) {
  return search.GET(context.request);
}
