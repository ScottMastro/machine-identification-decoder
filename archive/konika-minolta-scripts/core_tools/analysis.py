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

# Define block class assignments (time blocks)
block_classes = {4: "time", 5: "time", 10: "time", 11: "time", 15: "time", 24: "time", 25: "time", 26: "time", 
                 0: "constant", 1: "constant", 6:"constant",
                 2: "model", 3:"model", 7: "model"}
class_colors = {"constant": "black", "time": "skyblue", "model":"coral", "default": "black"}

# Directory containing the dot files
dot_files_dir = "./manual_dots"

# Get a sample file to read
sample_file = next((f for f in os.listdir(dot_files_dir) if f.endswith(".txt")), None)

for sample_file in os.listdir(dot_files_dir):
    if not sample_file.endswith("1015.txt"):
        continue  # Skip non-text files

    #if not "1012" in sample_file:
    #    continue  # Skip non-text files

    file_path = os.path.join(dot_files_dir, sample_file)

    with open(file_path, "r") as f:
        matrix = np.array([list(map(int, line.split())) for line in f.readlines()])


    file_path = os.path.join(dot_files_dir, sample_file)
    with open(file_path, "r") as f:
        matrix = np.array([list(map(int, line.split())) for line in f.readlines()])

    num_rows, num_cols = matrix.shape

    # Define annotation mapping for block positions
    block_annotations = np.array([[0, 1], [2, 3], [4, 5]])

    # Extract and store blocks
    block_values = {}
    one_hot_values = {}  # Store one-hot values for later use
    for block_id, (r, c) in block_positions.items():
        block = np.zeros((BLOCK_HEIGHT, BLOCK_WIDTH), dtype=int)
        one_hot_value = None
        for i in range(BLOCK_HEIGHT):
            for j in range(BLOCK_WIDTH):
                col_idx = (c + j) % num_cols  # Wrap-around effect
                block[i, j] = matrix[(r + i) % num_rows, col_idx]
                if block[i, j] == 1:  # Only keep first "1" found in block
                    one_hot_value = block_annotations[i, j]

        block_values[block_id] = (r, c, block)
        one_hot_values[block_id] = one_hot_value  # Store one-hot encoded value

    model_code=str(one_hot_values[7]) + str(one_hot_values[3]) + str(one_hot_values[2])
    print(sample_file, model_code, int(model_code, 6) )


    # Define block order for rearranging in the second plot
    static_blocks = [0]
    model_blocks = [7,3,2]
    paired_blocks = [16,18, 14,27, 17,19, 8,28, 9,29, 20,21, 22,12, 13,23]
    time_block_order = [25, 24, 4, 26, 10, 5, 15, 11]  # HHDDMMYY order
    block_order = static_blocks + model_blocks + paired_blocks + time_block_order

    # Create figure with three subplots (main matrix + rearranged blocks + decoded values)
    fig, axes = plt.subplots(3, 1, figsize=(12, 15), gridspec_kw={'height_ratios': [2, 1, 0.5]})

    # --- First subplot: Plot the main matrix with annotated blocks ---
    ax1 = axes[0]
    ax1.imshow(matrix, cmap="gray_r", interpolation="nearest")

    # Draw grid lines
    ax1.set_xticks(np.arange(-0.5, num_cols, 1), minor=True)
    ax1.set_yticks(np.arange(-0.5, num_rows, 1), minor=True)
    ax1.grid(which="minor", color="black", linestyle="-", linewidth=0.5)

    for block_id, (r, c, block) in block_values.items():
        block_class = block_classes.get(block_id, "default")
        color = class_colors[block_class]
        rect = patches.Rectangle((c - 0.5, r - 0.5), BLOCK_WIDTH, BLOCK_HEIGHT, linewidth=4, edgecolor=color, facecolor='none')
        ax1.add_patch(rect)

        # Annotate the block number
        ax1.text(c, r, str(block_id), fontsize=12, color="black", ha="center", va="center",
                 bbox=dict(facecolor='white', alpha=0.6))

    ax1.set_title(f"Matrix with Highlighted One-Hot Encoding Blocks ({sample_file})")

    # --- Second subplot: Rearranged blocks in a single row ---
    n_blocks = len(block_order)
    rearranged_matrix = np.zeros((BLOCK_HEIGHT, n_blocks * BLOCK_WIDTH), dtype=int)

    for idx, block_id in enumerate(block_order):
        _, _, block = block_values[block_id]
        rearranged_matrix[:, idx * BLOCK_WIDTH: (idx + 1) * BLOCK_WIDTH] = block

    ax2 = axes[1]
    ax2.imshow(rearranged_matrix, cmap="gray_r", interpolation="nearest")

    for idx, block_id in enumerate(block_order):
        block_class = block_classes.get(block_id, "default")
        color = class_colors[block_class]
        rect = patches.Rectangle((idx * BLOCK_WIDTH - 0.5, -0.5), BLOCK_WIDTH, BLOCK_HEIGHT, linewidth=2, edgecolor=color, facecolor='none')
        ax2.add_patch(rect)
        
        # Annotate block ID
        ax2.text(idx * BLOCK_WIDTH + BLOCK_WIDTH / 4, -1.5, str(block_id), fontsize=10, color="black", ha="center", va="center",
                 bbox=dict(facecolor='white', alpha=0.6))

        # Annotate the one-hot value below the block
        if one_hot_values[block_id] is not None:
            ax2.text(idx * BLOCK_WIDTH + BLOCK_WIDTH / 4, BLOCK_HEIGHT + 0.5, str(one_hot_values[block_id]),
                     fontsize=10, color="black", ha="center", va="center", bbox=dict(facecolor='white', alpha=0.6))

    ax2.set_xticks([])
    ax2.set_yticks([])

    # --- Third subplot: Annotate decoded values ---

    
    # Define the decoding formats as a list of format strings
    decoding_formats = [
        "HhDdMmYy",  # mc8650, 2000 offset / Bizhub 350C, DialtaColor CF-2001, CF-CF1501 - 1990 offset?
        "dDMmXyXY",  # Bizhub C754, Y is unknown but 11 gives 2010 offset
    ]

    #time_block_order = [25, 24, 4, 26, 10, 5, 15, 11] 

    # Define month names
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    # Generate formatted decoded values
    decoded_results = {}

    for format_string in decoding_formats:
        decoded_values = {}

        # Assign each block to its corresponding time component
        for i, char in enumerate(format_string):
            block_value = one_hot_values.get(time_block_order[i], 0)  # Get one-hot encoded value
            decoded_values[char] = str(block_value)

        # Reconstruct in the standard order HhDdMmYy
        formatted_output = format_string + ": "

        for key in ["Mm", "Dd","Yy", "Hh"]: 
            if key[0] not in decoded_values or key[1] not in decoded_values: 
                continue
            base6_str = decoded_values[key[0]] + decoded_values[key[1]]  # Concatenate the high and low digits
            decimal_value = int(base6_str, 6)  # Convert from base-6 to decimal

            if key in "Hh" and 0 <= decimal_value < 24:
                formatted_value = f"{decimal_value:02d}:00"  # Format hours
            elif key in "Mm" and 1 <= decimal_value <= 12:
                formatted_value = month_names[decimal_value - 1]  # Convert month to name
            elif key in "Dd" and 1 <= decimal_value <= 31:
                formatted_value = str(decimal_value)  # Valid day
            elif key in "Yy":
                formatted_value = "(" + str(decimal_value).zfill(2) +  ")" # Keep as 2-digit year
            else:
                formatted_value = "??"  # Invalid value

            formatted_output += formatted_value + " "

        decoded_results[format_string] = formatted_output.strip()

    ax3 = axes[2]
    y_position = 0.8
    for format_string, formatted_string in decoded_results.items():
        ax3.text(0.5, y_position, formatted_string, fontsize=12, ha="center", va="center",
                 bbox=dict(facecolor='white', alpha=0.6))
        y_position -= 0.3

    ax3.set_xticks([])
    ax3.set_yticks([])
    ax3.set_frame_on(False)

    plt.tight_layout()
    output_path = os.path.join(dot_files_dir, f"{os.path.splitext(sample_file)[0]}.data.png")
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    plt.close()



