import { SearchPage } from "./SearchPage";

// LinkedIn resolution on add runs an Apify LinkedIn search (10-30s) per
// batch — same timeout bump as /contacts/[id] for its Apify scrape.
export const maxDuration = 60;

export default function Search() {
  return <SearchPage />;
}
