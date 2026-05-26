import requests
import pandas as pd
import time
import os

API_KEY = "U4F6cJHtV09nTaCCumGfP7WHMh1Tyi1V2ZeM4ok9" # 🔒 keep private

def fetch_papers(queries=None, target_count=1000, output_path="../ai-engine/data/materials_research_dataset.csv"):
    """
    Fetches materials science papers from Semantic Scholar API.
    Saves to the ai-engine data directory.
    """
    if queries is None:
        queries = [
            "advanced materials", "nanomaterials", "biomaterials", "polymer nanocomposites",
            "energy materials", "lithium ion battery materials", "semiconductor materials",
            "composite materials", "ceramic materials", "metallurgy materials",
            "smart materials", "functional materials", "metamaterials"
        ]

    headers = {"x-api-key": API_KEY}
    url = "https://api.semanticscholar.org/graph/v1/paper/search/bulk"

    # Ensure output directory exists (relative to script location)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    all_papers = []
    seen_titles = set()

    for query in queries:
        if len(all_papers) >= target_count: break
        print(f"Searching: {query}")
        token = None

        while len(all_papers) < target_count:
            params = {"query": query, "limit": 100, "fields": "title,abstract,year"}
            if token: params["token"] = token

            try:
                response = requests.get(url, headers=headers, params=params)
                if response.status_code == 429:
                    time.sleep(10); continue
                if response.status_code != 200: break

                data = response.json()
                token = data.get("token")
                if not data.get("data"): break

                for paper in data["data"]:
                    title, abstract = paper.get("title"), paper.get("abstract")
                    if title and abstract and title not in seen_titles:
                        all_papers.append({"title": title, "abstract": abstract, "year": paper.get("year")})
                        seen_titles.add(title)

                print(f"Collected {len(all_papers)} papers...")
                if not token: break
                time.sleep(1)
            except Exception as e:
                print(f"Error: {e}"); time.sleep(5)

    df = pd.DataFrame(all_papers)
    df.to_csv(output_path, index=False)
    print(f"Extraction complete. Saved to {output_path}")
    return output_path

if __name__ == "__main__":
    fetch_papers()
