import os
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches

# Configuration: Number of top correlated pairs to display
TOP_N_PAIRS = 20
GRID_ROWS = 2  # Number of rows for subplot arrangement
GRID_COLS = (TOP_N_PAIRS + GRID_ROWS - 1) // GRID_ROWS  # Compute columns dynamically

# Directory containing the dot files
dot_files_dir = "./manual_dots"

# Get list of all text files in the directory
dot_files = [f for f in os.listdir(dot_files_dir) if f.endswith(".txt")]

# Initialize a dictionary to store matrices
matrices = {}

# Read each file and store the grid as a numpy array
for file in dot_files:
    file_path = os.path.join(dot_files_dir, file)
    with open(file_path, "r") as f:
        matrix = np.array([list(map(int, line.split())) for line in f.readlines()])
        matrices[file] = matrix

# Convert matrices to a 3D numpy array (num_files x rows x cols)
matrix_stack = np.array(list(matrices.values()))
num_files, num_rows, num_cols = matrix_stack.shape

# Compute the variance of each cell across all matrices
variance_matrix = np.var(matrix_stack, axis=0)

# Identify cells with non-zero variance
non_zero_var_mask = variance_matrix > 0
varying_indices = np.argwhere(non_zero_var_mask)

# Extract only varying cells and reshape into a 2D array (num_files x num_varying_cells)
varying_data = matrix_stack[:, non_zero_var_mask]

# Compute pairwise correlations for varying cells
correlation_matrix = np.corrcoef(varying_data.T)

# Find the top N strongest correlated pairs (absolute correlation)
num_varying_cells = varying_data.shape[1]
corr_pairs = []
for i in range(num_varying_cells):
    for j in range(i + 1, num_varying_cells):
        corr_pairs.append((i, j, correlation_matrix[i, j]))

# Sort by absolute correlation and take the top N
top_pairs = sorted(corr_pairs, key=lambda x: abs(x[2]), reverse=True)[:TOP_N_PAIRS]

# Compute the average value for each cell across all grids
average_matrix = np.mean(matrix_stack, axis=0)

# Create subplots for the top correlated pairs heatmap
fig, axes = plt.subplots(GRID_ROWS, GRID_COLS, figsize=(GRID_COLS * 3, GRID_ROWS * 3))
axes = axes.flatten()

for i, (idx1, idx2, corr_value) in enumerate(top_pairs):
    # Get the original positions of the correlated pair
    (r1, c1) = varying_indices[idx1]
    (r2, c2) = varying_indices[idx2]

    # Plot average heatmap
    ax = axes[i]
    ax.imshow(average_matrix, cmap="hot", interpolation="nearest")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title(f"Pair {idx1}-{idx2} (Corr: {corr_value:.2f})")

    # Draw blue square around correlated cells
    rect_size = 1  # Defines the size of the square
    rect1 = patches.Rectangle((c1 - 0.5, r1 - 0.5), rect_size, rect_size, linewidth=2, edgecolor='blue', facecolor='none')
    rect2 = patches.Rectangle((c2 - 0.5, r2 - 0.5), rect_size, rect_size, linewidth=2, edgecolor='blue', facecolor='none')

    ax.add_patch(rect1)
    ax.add_patch(rect2)

# Hide any extra subplots
for j in range(i + 1, len(axes)):
    axes[j].axis("off")

plt.suptitle(f"Top {TOP_N_PAIRS} Strongest Correlated Cell Pairs")
plt.tight_layout()
plt.show()

