import * as stormySearch from "../../api/stormy-search.js";

export async function OPTIONS() {
  return stormySearch.OPTIONS();
}

export async function GET(context) {
  return stormySearch.GET(context.request);
}

export async function POST(context) {
  return stormySearch.POST(context.request);
}
