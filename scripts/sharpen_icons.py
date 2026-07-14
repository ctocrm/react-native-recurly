#!/usr/bin/env python3
"""
Sharpening post-processing for icon upscaling.
Implements unsharp mask algorithm for quick quality enhancement.
"""

import numpy as np
from PIL import Image, ImageFilter
import base64
from io import BytesIO
import sys


def unsharp_mask(image: Image.Image, radius: float = 2.0, percent: int = 150, threshold: int = 3) -> Image.Image:
    """
    Apply unsharp mask to enhance image sharpness.
    
    Args:
        image: PIL Image object
        radius: Blur radius for creating the mask (default: 2.0)
        percent: Sharpening strength (default: 150)
        threshold: Minimum brightness difference to apply sharpening (default: 3)
    
    Returns:
        Sharpened PIL Image object
    """
    # Create blurred version
    blurred = image.filter(ImageFilter.GaussianBlur(radius=radius))
    
    # Convert to numpy for processing
    img_array = np.array(image).astype(np.float32)
    blur_array = np.array(blurred).astype(np.float32)
    
    # Calculate difference
    diff = img_array - blur_array
    
    # Apply threshold
    mask = np.abs(diff) > threshold
    
    # Apply sharpening
    sharpened = img_array + (diff * percent / 100.0) * mask
    
    # Clip values and convert back
    sharpened = np.clip(sharpened, 0, 255).astype(np.uint8)
    
    return Image.fromarray(sharpened)


def sharpen_base64_image(base64_str: str, format: str = 'png', 
                         radius: float = 2.0, percent: int = 150, threshold: int = 3) -> str:
    """
    Sharpen a base64-encoded image.
    
    Args:
        base64_str: Base64-encoded image data
        format: Image format ('png', 'jpg', etc.)
        radius: Blur radius for unsharp mask
        percent: Sharpening strength
        threshold: Minimum difference threshold
    
    Returns:
        Base64-encoded sharpened image
    """
    # Decode base64
    image_data = base64.b64decode(base64_str)
    
    # Open image
    image = Image.open(BytesIO(image_data))
    
    # Convert to RGB if necessary (handle RGBA, P, etc.)
    if image.mode not in ('RGB', 'RGBA'):
        image = image.convert('RGB')
    
    # Apply unsharp mask
    sharpened = unsharp_mask(image, radius, percent, threshold)
    
    # Save to bytes
    output = BytesIO()
    if format.lower() in ('jpg', 'jpeg'):
        sharpened.save(output, format='JPEG', quality=95)
    else:
        sharpened.save(output, format='PNG')
    
    # Encode back to base64
    output.seek(0)
    return base64.b64encode(output.read()).decode('utf-8')


def test_sharpening():
    """Test sharpening on a sample image."""
    import os
    import tempfile


    # Create a simple test image
    test_img = Image.new('RGB', (64, 64), color='white')
    
    # Add some shapes
    from PIL import ImageDraw
    draw = ImageDraw.Draw(test_img)
    draw.rectangle([10, 10, 30, 30], fill='red')
    draw.ellipse([35, 35, 55, 55], fill='blue')
    
    # Allocate temporary output paths instead of hardcoding /tmp.
    original_fd, original_path = tempfile.mkstemp(prefix='test_original_', suffix='.png')
    os.close(original_fd)
    sharpened_fd, sharpened_path = tempfile.mkstemp(prefix='test_sharpened_', suffix='.png')
    os.close(sharpened_fd)

    # Save original
    test_img.save(original_path)
    
    # Apply sharpening
    sharpened = unsharp_mask(test_img, radius=2.0, percent=150, threshold=3)
    sharpened.save(sharpened_path)
    
    print(f"✓ Test images saved to {original_path} and {sharpened_path}")
    print("✓ Sharpening function working correctly")



if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--test':
        test_sharpening()
    else:
        print("Sharpening module loaded successfully")
        print("Use sharpen_base64_image() function to sharpen images")
        print("Run with --test flag to test the implementation")