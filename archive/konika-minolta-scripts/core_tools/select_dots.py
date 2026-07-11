import tkinter as tk
import numpy as np
from tkinter import simpledialog, messagebox
from PIL import Image, ImageDraw

GRID_ROWS = 16  # Grid height
GRID_COLS = 24  # Grid width
CELL_SIZE = 40  # Cell size in pixels
THICK_BORDER_COLS = {3, 6, 9, 12, 15, 18, 21}  # Thick border after these columns
THICK_BORDER_ROWS = {4, 8, 12}  # Thick border after these rows

class GridEditor:
    def __init__(self, root, rows=GRID_ROWS, cols=GRID_COLS):
        self.rows = rows
        self.cols = cols
        self.grid_data = np.zeros((rows, cols), dtype=int)

        self.canvas = tk.Canvas(root, width=cols*CELL_SIZE, height=rows*CELL_SIZE, bg="white")
        self.canvas.pack()

        self.draw_grid()
        self.canvas.bind("<Button-1>", self.toggle_cell)

        # Buttons
        self.btn_save_txt = tk.Button(root, text="Save Grid (TXT)", command=self.save_grid)
        self.btn_save_txt.pack(side=tk.LEFT, padx=5)

        self.btn_load = tk.Button(root, text="Load Grid", command=self.load_grid)
        self.btn_load.pack(side=tk.LEFT, padx=5)

        self.btn_save_image = tk.Button(root, text="Save Grid (PNG)", command=self.save_grid_image)
        self.btn_save_image.pack(side=tk.LEFT, padx=5)

    def draw_grid(self):
        """Draws the grid lines and fills in the black dots."""
        self.canvas.delete("all")
        for i in range(self.rows):
            for j in range(self.cols):
                x1, y1 = j * CELL_SIZE, i * CELL_SIZE
                x2, y2 = x1 + CELL_SIZE, y1 + CELL_SIZE
                fill_color = "black" if self.grid_data[i, j] == 1 else "white"
                
                self.canvas.create_rectangle(x1, y1, x2, y2, outline="gray", fill=fill_color, tags=f"cell_{i}_{j}")

        # Draw thick vertical borders after columns 3, 6, 9, etc.
        for col in THICK_BORDER_COLS:
            x = col * CELL_SIZE
            self.canvas.create_line(x, 0, x, self.rows * CELL_SIZE, width=3, fill="black")

        # Draw thick horizontal borders after rows 4, 8, 12, etc.
        for row in THICK_BORDER_ROWS:
            y = row * CELL_SIZE
            self.canvas.create_line(0, y, self.cols * CELL_SIZE, y, width=3, fill="black")

    def toggle_cell(self, event):
        """Toggles a cell between 0 (white) and 1 (black) when clicked."""
        col, row = event.x // CELL_SIZE, event.y // CELL_SIZE
        if 0 <= row < self.rows and 0 <= col < self.cols:
            self.grid_data[row, col] = 1 - self.grid_data[row, col]  # Toggle between 0 and 1
            self.draw_grid()

    def save_grid(self):
        """Prompts for a filename and saves the grid as a text file."""
        filename = simpledialog.askstring("Save Grid", "Enter filename (without extension):")
        if filename:
            np.savetxt(f"{filename}.txt", self.grid_data, fmt="%d")
            messagebox.showinfo("Success", f"Grid saved as {filename}.txt")
        else:
            messagebox.showwarning("Warning", "No filename entered. Grid not saved.")

    def load_grid(self):
        """Loads the grid from a text file (if available)."""
        filename = simpledialog.askstring("Load Grid", "Enter filename to load (without extension):")
        if filename:
            try:
                self.grid_data = np.loadtxt(f"{filename}.txt", dtype=int)
                self.draw_grid()
                messagebox.showinfo("Success", f"Grid loaded from {filename}.txt")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to load {filename}.txt\n{e}")

    def save_grid_image(self):
        """Saves the grid as a PNG image."""
        filename = simpledialog.askstring("Save Grid as Image", "Enter filename (without extension):")
        if filename:
            img_size = (self.cols * CELL_SIZE, self.rows * CELL_SIZE)
            img = Image.new("RGB", img_size, "white")
            draw = ImageDraw.Draw(img)

            # Draw grid cells
            for i in range(self.rows):
                for j in range(self.cols):
                    x1, y1 = j * CELL_SIZE, i * CELL_SIZE
                    x2, y2 = x1 + CELL_SIZE, y1 + CELL_SIZE
                    fill_color = "black" if self.grid_data[i, j] == 1 else "white"
                    draw.rectangle([x1, y1, x2, y2], fill=fill_color, outline="gray")

            # Draw thick vertical borders
            for col in THICK_BORDER_COLS:
                x = col * CELL_SIZE
                draw.line([x, 0, x, self.rows * CELL_SIZE], fill="black", width=3)

            # Draw thick horizontal borders
            for row in THICK_BORDER_ROWS:
                y = row * CELL_SIZE
                draw.line([0, y, self.cols * CELL_SIZE, y], fill="black", width=3)

            img.save(f"{filename}.png")
            messagebox.showinfo("Success", f"Grid saved as {filename}.png")

if __name__ == "__main__":
    root = tk.Tk()
    root.title("Grid Editor - Click to Toggle Dots")
    app = GridEditor(root)
    root.mainloop()

