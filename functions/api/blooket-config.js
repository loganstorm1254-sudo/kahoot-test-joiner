import * as config from "../../api/blooket-config.js";

export async function onRequestOptions() {
  return config.OPTIONS();
}

export async function onRequestGet() {
  return config.GET();
}
