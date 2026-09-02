import * as quiz from "../../api/quiz.js";

export async function onRequestOptions() {
  return quiz.OPTIONS();
}

export async function onRequestGet(context) {
  return quiz.GET(context.request);
}
