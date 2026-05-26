import torch
import os
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

def run_inference(model_path="../ai-engine/models/materials_gemma_lora", base_model="google/gemma-2b-it"):
    """
    Stage 4: Model Testing / Inference
    Tests the fine-tuned model on sample questions to verify instruction following.
    """
    print(f"Loading base model: {base_model}...")
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    model = AutoModelForCausalLM.from_pretrained(base_model, torch_dtype=torch.float16, device_map="auto")
    
    if os.path.exists(model_path):
        print(f"Loading fine-tuned adapters from {model_path}...")
        model = PeftModel.from_pretrained(model, model_path)
    else:
        print("⚠️ Warning: Fine-tuned adapters not found. Running base model only.")
    
    model.eval()

    questions = [
        "What are the properties of nanomaterials?",
        "Explain the importance of lithium ion battery materials.",
        "How do polymer nanocomposites improve material strength?"
    ]

    print("\n" + "="*50)
    print("      INSTRUCTION TUNING VERIFICATION")
    print("="*50)

    for question in questions:
        prompt = f"### Instruction:\nAnswer the materials science question.\n\n### Question:\n{question}\n\n### Answer:\n"
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        
        with torch.no_grad():
            outputs = model.generate(**inputs, max_new_tokens=200)
        
        response = tokenizer.decode(outputs[0], skip_special_tokens=True)
        print(f"\nQ: {question}")
        print(f"A: {response.split('### Answer:')[-1].strip()}")

    print("\n" + "="*50)

if __name__ == "__main__":
    run_inference()
