import jwt
import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime, timedelta, timezone

# --- Configuration ---
# IMPORTANT: This secret key MUST be the same as the one in your Node.js .env file.
SECRET_KEY = "your-super-secret-and-long-key-that-no-one-can-guess"

class TokenGeneratorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Metro Mithra Token Generator")
        self.root.geometry("450x350")

        # --- Role Data ---
        self.roles_by_category = {
            "Central Command": ["Managing Director", "Director of Finance", "Director of Operations"],
            "Field Units": ["Station Controller", "Depot Manager"]
        }

        # Style
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("TLabel", padding=6, font=("Helvetica", 10))
        style.configure("TEntry", padding=6, font=("Helvetica", 10))
        style.configure("TButton", padding=6, font=("Helvetica", 10, "bold"))
        style.configure("TCombobox", padding=6, font=("Helvetica", 10))

        main_frame = ttk.Frame(self.root, padding="20")
        main_frame.pack(expand=True, fill=tk.BOTH)

        # --- UI Elements ---
        # Name
        ttk.Label(main_frame, text="User Name:").grid(row=0, column=0, sticky="w")
        self.name_var = tk.StringVar()
        ttk.Entry(main_frame, textvariable=self.name_var, width=40).grid(row=0, column=1, pady=5)

        # Category
        ttk.Label(main_frame, text="Category:").grid(row=1, column=0, sticky="w")
        self.category_var = tk.StringVar()
        self.category_combo = ttk.Combobox(main_frame, textvariable=self.category_var, values=list(self.roles_by_category.keys()), state="readonly", width=38)
        self.category_combo.grid(row=1, column=1, pady=5)
        self.category_combo.set("Central Command") # Set default
        self.category_combo.bind("<<ComboboxSelected>>", self.update_roles)

        # Role
        ttk.Label(main_frame, text="Role:").grid(row=2, column=0, sticky="w")
        self.role_var = tk.StringVar()
        self.role_combo = ttk.Combobox(main_frame, textvariable=self.role_var, state="readonly", width=38)
        self.role_combo.grid(row=2, column=1, pady=5)
        
        # Initialize roles for the first time
        self.update_roles()

        # Generate Button
        generate_button = ttk.Button(main_frame, text="Generate Token", command=self.generate_token)
        generate_button.grid(row=3, column=0, columnspan=2, pady=15)

        # Result Text
        ttk.Label(main_frame, text="Generated Token:").grid(row=4, column=0, columnspan=2, sticky="w")
        self.token_text = tk.Text(main_frame, height=5, width=50, wrap=tk.WORD, font=("Courier", 9))
        self.token_text.grid(row=5, column=0, columnspan=2, pady=5)
        self.token_text.config(state=tk.DISABLED)

    def update_roles(self, event=None):
        """Updates the role dropdown based on the selected category."""
        selected_category = self.category_var.get()
        self.role_combo['values'] = self.roles_by_category[selected_category]
        self.role_combo.set(self.roles_by_category[selected_category][0]) # Set to the first role in the new list

    def generate_token(self):
        name = self.name_var.get().strip()
        role = self.role_var.get()
        category = self.category_var.get()

        if not name:
            messagebox.showerror("Error", "User Name cannot be empty.")
            return

        # Token expires in 30 days from now
        expiration_time = datetime.now(timezone.utc) + timedelta(days=30)

        payload = {
            "name": name,
            "role": role,
            "category": category,
            "exp": expiration_time,
            "iat": datetime.now(timezone.utc)
        }

        try:
            token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
            self.token_text.config(state=tk.NORMAL)
            self.token_text.delete(1.0, tk.END)
            self.token_text.insert(tk.END, token)
            self.token_text.config(state=tk.DISABLED)
            self.root.clipboard_clear()
            self.root.clipboard_append(token)
            messagebox.showinfo("Success", "Token generated and copied to clipboard!")
        except Exception as e:
            messagebox.showerror("Generation Failed", f"An error occurred: {e}")

if __name__ == "__main__":
    app_root = tk.Tk()
    app = TokenGeneratorApp(app_root)
    app_root.mainloop()