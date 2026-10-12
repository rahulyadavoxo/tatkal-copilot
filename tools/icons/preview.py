import math, cairosvg, icons_spec as S
SW=S.SW
def prim_svg(p,col):
    k=p[0]
    if k=='L':
        _,x1,y1,x2,y2=p; return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="{SW}" stroke-linecap="round"/>'
    if k=='C':
        _,cx,cy,r=p; return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{col}" stroke-width="{SW}"/>'
    if k=='CF':
        _,cx,cy,r=p; return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{col}"/>'
    if k=='R':
        _,x,y,w,h,rad=p; return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rad}" fill="none" stroke="{col}" stroke-width="{SW}"/>'
    if k=='A':
        _,cx,cy,r,sides,rot=p; out=''
        for a0,a1 in S.arc_ends(cx,cy,r,sides,rot):
            x0,y0=S.pt(cx,cy,r,a0); x1,y1=S.pt(cx,cy,r,a1)
            out+=f'<path d="M{x0:.3f} {y0:.3f} A{r} {r} 0 0 1 {x1:.3f} {y1:.3f}" fill="none" stroke="{col}" stroke-width="{SW}"/>'
        return out
def icon_svg(name,col='#0F0F14'):
    return ''.join(prim_svg(p,col) for p in S.ICONS[name])
def sheet(path,col='#0F0F14',bg='#FFFFFF',scale=4):
    names=list(S.ICONS); cols=6; cell=40
    rows=math.ceil(len(names)/cols)
    W=cols*cell; H=rows*(cell+10)
    body=''
    for i,n in enumerate(names):
        x=(i%cols)*cell+8; y=(i//cols)*(cell+10)+4
        body+=f'<g transform="translate({x},{y})"><rect width="24" height="24" fill="none" stroke="#e6e6ee" stroke-width="0.2"/>{icon_svg(n,col)}</g>'
        body+=f'<text x="{x+12}" y="{y+34}" font-size="5" text-anchor="middle" fill="#888" font-family="sans-serif">{n}</text>'
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W*scale}" height="{H*scale}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="{bg}"/>{body}</svg>'
    cairosvg.svg2png(bytestring=svg.encode(),write_to=path)
if __name__=='__main__':
    sheet('icon-sheet.png')
