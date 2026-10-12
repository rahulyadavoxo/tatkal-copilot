import cairosvg
VIO1='#7B5CFF'; VIO2='#4A2FD9'; WHITE='#FFFFFF'; ACC='#FFC94D'
def mark(cx=512,cy=540,s=1.0,ring=WHITE,body=WHITE,cut='url(#bg)'):
    # stopwatch ring + crown, train front inside. s = scale around center
    return f'''<g transform="translate({cx},{cy}) scale({s}) translate(-512,-540)">
  <rect x="462" y="150" width="100" height="58" rx="22" fill="{ring}"/>
  <rect x="494" y="196" width="36" height="44" fill="{ring}"/>
  <g transform="rotate(45 512 560)"><rect x="494" y="200" width="36" height="40" fill="{ring}"/><rect x="472" y="166" width="80" height="46" rx="18" fill="{ring}"/></g>
  <circle cx="512" cy="560" r="300" fill="none" stroke="{ring}" stroke-width="56"/>
  <!-- train front -->
  <rect x="372" y="380" width="280" height="300" rx="78" fill="{body}"/>
  <rect x="412" y="428" width="200" height="104" rx="34" fill="{cut}"/>
  <circle cx="440" cy="602" r="24" fill="{ACC}"/>
  <circle cx="584" cy="602" r="24" fill="{ACC}"/>
  <rect x="474" y="590" width="76" height="24" rx="12" fill="{cut}"/>
  <path d="M430 680 L392 752" stroke="{body}" stroke-width="40" stroke-linecap="round"/>
  <path d="M594 680 L632 752" stroke="{body}" stroke-width="40" stroke-linecap="round"/>
</g>'''
DEFS=f'''<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{VIO1}"/><stop offset="1" stop-color="{VIO2}"/></linearGradient></defs>'''
def full(rounded=False):
    rx = 230 if rounded else 0
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{DEFS}<rect width="1024" height="1024" rx="{rx}" fill="url(#bg)"/>{mark()}</svg>'
def foreground():
    # adaptive icon: content inside central 66% (safe zone ~ 676px)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{DEFS}{mark(512,512,0.72,cut="#5B3DF5")}</svg>'
def splash():
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{DEFS}<rect x="212" y="212" width="600" height="600" rx="150" fill="url(#bg)"/>{mark(512,512,0.5)}</svg>'
import os
out='out'; os.makedirs(out,exist_ok=True)
cairosvg.svg2png(bytestring=full().encode(),write_to=f'{out}/icon.png')
cairosvg.svg2png(bytestring=full(True).encode(),write_to=f'{out}/icon-rounded.png')
cairosvg.svg2png(bytestring=foreground().encode(),write_to=f'{out}/adaptive-icon.png')
cairosvg.svg2png(bytestring=splash().encode(),write_to=f'{out}/splash-icon.png')
open(f'{out}/logo.svg','w').write(full(True))
