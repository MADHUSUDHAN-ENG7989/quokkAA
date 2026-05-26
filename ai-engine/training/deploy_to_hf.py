import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel
from huggingface_hub import HfApi, login
import os

# --- CONFIGURATION ---
token = os.environ.get("HF_TOKEN", "YOUR_HF_TOKEN_HERE")
base_model_id = "Qwen/Qwen2.5-0.5B-Instruct"
script_dir = os.path.dirname(os.path.abspath(__file__))
adapter_dir = os.path.join(script_dir, "..", "models", "adapters", "qwen_adapters")
repo_name = "qwen2.5-0.5b-materials-science" # You can change this name

def deploy():
    print("Logging into Hugging Face...")
    login(token=token)

    print(f"Loading base model: {base_model_id}...")
    # Use dtype instead of torch_dtype to avoid warnings
    model = AutoModelForCausalLM.from_pretrained(
        base_model_id,
        dtype=torch.float16,
        device_map={"": "cpu"},
        trust_remote_code=True
    )

    print(f"Loading adapters from {adapter_dir}...")
    model = PeftModel.from_pretrained(model, adapter_dir)

    print("Merging adapters into base model...")
    model = model.merge_and_unload()

    print(f"Pushing merged model to HF Hub: {repo_name}...")
    model.push_to_hub(repo_name)
    
    print("Pushing tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(base_model_id, trust_remote_code=True)
    tokenizer.push_to_hub(repo_name)

    print(f"\n✅ Success! Your model is now live at: https://huggingface.co/ (check your profile for {repo_name})")

if __name__ == "__main__":
    deploy()
