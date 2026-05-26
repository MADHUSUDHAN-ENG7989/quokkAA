import json
import os
import pandas as pd
import torch
import re
from transformers import AutoTokenizer, AutoModelForCausalLM
from tqdm import tqdm

# =========================
# CONFIG
# =========================
MODEL_NAME = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
INSTRUCTION_TEXT = "Provide a clear definition, an example, and 3 key points for the given question. Format the response with exact headings."

def process_to_jsonl(input_csv="../ai-engine/data/materials_research_dataset.csv", output_jsonl="../ai-engine/data/train.jsonl", sample_size=1000):
    """
    Converts research abstracts into structured Q&A pairs.
    Format: Definition, Example, Key Points.
    """
    print(f"Loading model: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME, torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32, device_map="auto"
    )
    model.eval()

    if not os.path.exists(input_csv):
        print("Input CSV not found!")
        return

    df = pd.read_csv(input_csv)
    df = df.sample(n=min(len(df), sample_size), random_state=42)

    os.makedirs(os.path.dirname(os.path.abspath(output_jsonl)), exist_ok=True)

    with open(output_jsonl, "a", encoding="utf-8") as f_out: # Append to existing train.jsonl
        for _, row in tqdm(df.iterrows(), total=len(df)):
            title, abstract = str(row.get("title", "")), str(row.get("abstract", ""))
            if len(abstract) < 100: continue

            # Refined prompt to get the exact format required
            prompt = f"""<|system|>
You are a materials science expert. 
Extract 1 important concept from the text and format it EXACTLY as follows:
Definition: [1 sentence definition]
Example: [1 sentence example]
Key Points:
1. [Point 1]
2. [Point 2]
3. [Point 3]

Text: {title}. {abstract}
<|user|>
Generate the structured fact.
<|assistant|>
"""
            inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=1024).to(model.device)
            
            with torch.no_grad():
                outputs = model.generate(**inputs, max_new_tokens=512, do_sample=True, temperature=0.7)
            
            generated = tokenizer.decode(outputs[0], skip_special_tokens=True).split("<|assistant|>")[-1].strip()
            
            # Basic validation of format
            if "Definition:" in generated and "Example:" in generated and "Key Points:" in generated:
                # Extract the "Concept" for the 'input' field if possible, otherwise use the first line of definition
                concept = title if len(title) < 50 else title.split(":")[0]
                
                entry = {
                    "instruction": INSTRUCTION_TEXT,
                    "input": f"Tell me about {concept}.",
                    "output": generated
                }
                json.dump(entry, f_out, ensure_ascii=False)
                f_out.write("\n")

    print(f"Preprocessing complete. Appended results to {output_jsonl}")

if __name__ == "__main__":
    process_to_jsonl()
