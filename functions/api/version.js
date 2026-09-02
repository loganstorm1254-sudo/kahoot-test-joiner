import * as version from "../../api/version.js";

export async function onRequestOptions() {
  return version.OPTIONS();
}

export async function onRequestGet() {
  return version.GET();
}
