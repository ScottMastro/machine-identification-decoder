import os
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches

# Configuration
BLOCK_HEIGHT = 3
BLOCK_WIDTH = 2
NUM_CLASSES = 6  # One-hot encoding base

# Define block positions
block_positions = {
    0: (0, 0), 1: (0, 4), 2: (0, 8), 3: (0, 12), 4: (0, 16), 5: (0, 20),
    6: (3, 1), 7: (3, 5), 8: (3, 9), 9: (3, 13), 10: (3, 17), 11: (3, 21),
    12: (6, 2), 13: (6, 6), 14: (6, 10), 15: (6, 14), 16: (6, 18), 17: (6, 22),
    18: (9, 3), 19: (9, 7), 20: (9, 11), 21: (9, 15), 22: (9, 19), 23: (9, 23),
    24: (12, 0), 25: (12, 4), 26: (12, 8), 27: (12, 12), 28: (12, 16), 29: (12, 20),
}

# Example class assignment (blocks 4 & 5 are "time" blocks)
block_classes = {4: "time", 5: "time", 10:"time", 11:"time", 15:"time", 24:"time", 25:"time", 26:"time"}

# Directory containing the dot files
dot_files_dir = "./manual_dots"

# Get a sample file to read
sample_file = next((f for f in os.listdir(dot_files_dir) if f.endswith(".txt")), None)

if sample_file:
    file_path = os.path.join(dot_files_dir, sample_file)
    with open(file_path, "r") as f:
        matrix = np.array([list(map(int, line.split())) for line in f.readlines()])

    num_rows, num_cols = matrix.shape

    # Define annotation mapping for block positions
    block_annotations = np.array([[0, 1], [2, 3], [4, 5]])

    # Generate block values
    block_values = {}
    for block_id, (r, c) in block_positions.items():
        block = np.zeros((BLOCK_HEIGHT, BLOCK_WIDTH), dtype=int)
        for i in range(BLOCK_HEIGHT):
            for j in range(BLOCK_WIDTH):
                col_idx = (c + j) % num_cols  # Wrap-around effect
                block[i, j] = matrix[(r + i) % num_rows, col_idx]

        block_values[block_id] = (r, c, block)

    # Plot the matrix with annotated blocks
    fig, ax = plt.subplots(figsize=(10, 8))
    ax.imshow(matrix, cmap="gray_r", interpolation="nearest")

    # Draw grid lines
    ax.set_xticks(np.arange(-0.5, num_cols, 1), minor=True)
    ax.set_yticks(np.arange(-0.5, num_rows, 1), minor=True)
    ax.grid(which="minor", color="black", linestyle="-", linewidth=0.5)

    for block_id, (r, c, block) in block_values.items():
        color = "red" if block_classes.get(block_id) == "time" else "blue"
        rect = patches.Rectangle((c - 0.5, r - 0.5), BLOCK_WIDTH, BLOCK_HEIGHT, linewidth=2, edgecolor=color, facecolor='none')
        ax.add_patch(rect)

        if(c > num_cols-2):
            print(1)
            rect = patches.Rectangle((- 1.5, r - 0.5), BLOCK_WIDTH, BLOCK_HEIGHT, linewidth=2, edgecolor=color, facecolor='none')
            ax.add_patch(rect)

        # Annotate the block number
        ax.text(c + BLOCK_WIDTH / 4, r + BLOCK_HEIGHT/4, str(block_id), fontsize=12, color="black", ha="center", va="center",
                bbox=dict(facecolor='white', alpha=0.6))

        # Annotate the first occurrence of "1" with its corresponding encoding
        #for i in range(BLOCK_HEIGHT):
        #    for j in range(BLOCK_WIDTH):
        #        col_idx = (c + j) % num_cols  # Wrap-around effect
        #        row_idx = (r + i) % num_rows
        #        if block[i, j] == 1:  # Only annotate "1" values
        #            ax.text(col_idx, row_idx, str(block_annotations[i, j]), fontsize=10, color="black",
        #                    ha="center", va="center", bbox=dict(facecolor='white', alpha=0.6))
        #            break  # Stop after the first "1" in the block

    plt.show()
else:
    print("No matrix files found in directory.")

