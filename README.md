# ESP32 S3 Sense Camera

## Materials:
- Xiao ESP32 S3 
- Xiao ESP Sense Camera
- SPI 240 x 240 color display
- 16 GB microSD card
- 1200 mAh Battery
- on/off switch for battery
- 5 way switch with UP/DOWN/LEFT/RIGHT/CENTER
- MPU-6050 Gyroscope & Accelerometer

## Goal:
Design a small digital camera that displays a color preview of the camera sensor, takes pictures and stores them to the sd card
Deploy a website to easily review the files on the microSD card and flash the ESP via WebSerial with the camera display firmware
Features -> add rotational camera overal display and directional image saving based on mpu-6050 input
Feature -> maybe add a flash module in the future

## Planned workflow:
1. simple smoke test, make a website that displays the current view in a 480 pixel x 480 pixel display, a take picture button on the top right of the display
2. file drop down section below the display on the website, saving image data by MMDDYY-HH:MM:SS format, and allowing user to filter by a specfic date (calendar range modal)

3. add camera style animations , center dot with center square (middle of a 3x3 grid box), add preview display with small border outline, then shrink to animate away or slide away image, bringing up current view. 

Once website can see live display of content for plugged in device
5. start working on making the SPI display show the content directly
6. add button clicking to take picutres of displayed content
7. design a file preview selection menu for the 240x240 display
8. deploy website to camera.nirvek.xyz using cloudflare-setup for proxmox server

### Extra features:
8. add orientention changing to the camera
9. add OTA image uploading to camera site (camera.nirvek.xyz) 
   1.  full camera images backup and preview of plugged in camera

