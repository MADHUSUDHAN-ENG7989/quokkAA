import os
from extract import fetch_papers
from preprocess import process_to_jsonl

def run_data_prep_pipeline(papers_to_fetch=500, samples_to_process=200):
    """
    Orchestrates the data extraction and preprocessing for the Quokka project.
    (Training is handled externally via Google Colab).
    """
    print("====================================================")
    print("      QUOKKA DATA PREPARATION PIPELINE             ")
    print("====================================================\n")
    
    csv_path = "../ai-engine/data/materials_research_dataset.csv"
    jsonl_path = "../ai-engine/data/train.jsonl"
    
    # 1. Extraction
    if not os.path.exists(csv_path):
        print("[STEP 1] Fetching data from Semantic Scholar...")
        fetch_papers(target_count=papers_to_fetch, output_path=csv_path)
    else:
        print(f"[STEP 1] Raw data found at {csv_path}. Skipping extraction.")

    # 2. Preprocessing
    print("\n[STEP 2] Preprocessing data into training format...")
    process_to_jsonl(input_csv=csv_path, output_jsonl=jsonl_path, sample_size=samples_to_process)

    print("\n====================================================")
    print("STATUS: DATA READY FOR CLOUD TRAINING (COLAB)")
    print("====================================================")

if __name__ == "__main__":
    run_data_prep_pipeline()
