export default /* glsl */`
varying vec3 vColor;

void main()
{
    float distanceToCenter = length(gl_PointCoord - 0.5);

    if(distanceToCenter > 0.5)
        discard;
    else
        gl_FragColor = vec4(vColor, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}

`;
