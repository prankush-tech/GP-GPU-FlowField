import * as THREE from "three";
import * as dat from "dat.gui";
import vertexShader from "../shaders/vertex.glsl";
import fragmentShader from "../shaders/fragment.glsl";
import AbstractImage from "/abs.png";
import gpgpuParticlesShader from "../shaders/gpgpu/particles.glsl";
import Stats from "stats.js";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Pane } from "tweakpane";
import { GPUComputationRenderer } from "three/examples/jsm/Addons.js";

export default class threeJS {
  constructor(options) {
    this.gsap = gsap.registerPlugin(ScrollTrigger);
    this.previousTime = 0;
    this.time = 0;
    this.container = options.dom;

    this.stats = new Stats();

    this.stats.showPanel(0);
    // this.container.appendChild(this.stats.dom);

    this.scene = new THREE.Scene();
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;

    this.camera = new THREE.PerspectiveCamera(
      35,
      window.innerWidth / window.innerHeight,
      0.01,
      1000
    );
    this.camera.position.set(15.5, 4, 10);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      // alpha:true
    });
    this.renderer.setSize(this.width, this.height);
    this.container.appendChild(this.renderer.domElement);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.params = {
      bgColor: "#000000",
      uSize: 0.1,
    };
    this.pane = new Pane();
    this.renderer.setClearColor(this.params.bgColor, 1);

    this.pane
      .addBinding(this.params, "bgColor", {
        picker: "inline",
        expandable: true,
      })
      .on("change", (ev) => {
        // Update the renderer's clear color dynamically
        this.renderer.setClearColor(ev.value, 1);
      });

    this.clock = new THREE.Clock();

    this.dracoloader = new DRACOLoader();
    this.dracoloader.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.6/"
    );
    // this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // this.renderer.toneMappingExposure = 1.6;

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoloader);
    this.isPlaying = true;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.update();
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    //bloom

    this.settings();
    this.initiPost();
    this.addObjects();
    this.render();
    this.resize();
    this.setupResize();
  }

  async addObjects() {
    // this.geometry = new THREE.SphereGeometry(3);
    // this.geometry2 = new THREE.PlaneGeometry(2, 2, 10, 10);
    // this.geometry = new THREE.IcosahedronGeometry(1,150);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uResolution: new THREE.Uniform(
          new THREE.Vector2(
            this.width * window.devicePixelRatio,
            this.height * window.devicePixelRatio
          )
        ),
        uParticlesTextures: new THREE.Uniform(),
        uSize: new THREE.Uniform(this.params.uSize),
        uTexture: { value: new THREE.TextureLoader().load(AbstractImage) },
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      // wireframe:true
    });

    //GpGPU


    //Load Model
    this.model = await this.gltfLoader.loadAsync('./model.glb')
    



    //BaseGeometry
    this.baseGeometry = {
      instance: this.model.scene.children[0].geometry,
      count: null,
    };
    this.baseGeometry.count =
      this.baseGeometry.instance.attributes.position.count;

    //Gpu Compute
    //Setup
    this.gpGpu = {
      size: Math.ceil(Math.sqrt(this.baseGeometry.count)),
      computation: null,
      particleVariable: null,
      debug: new THREE.Mesh(
        new THREE.PlaneGeometry(3, 3),
        new THREE.MeshBasicMaterial({
          map: null,
        })
      ),
    };

    this.gpGpu.computation = new GPUComputationRenderer(
      this.gpGpu.size,
      this.gpGpu.size,
      this.renderer
    );

    //Base particles
    this.baseParticlesTexture = this.gpGpu.computation.createTexture();

    for (let i = 0; i < this.baseGeometry.count; i++) {
      const i3 = i * 3;
      const i4 = i * 4;

      this.baseParticlesTexture.image.data[i4 + 0] =
        this.baseGeometry.instance.attributes.position.array[i3 + 0];

      this.baseParticlesTexture.image.data[i4 + 1] =
        this.baseGeometry.instance.attributes.position.array[i3 + 1];
      this.baseParticlesTexture.image.data[i4 + 2] =
        this.baseGeometry.instance.attributes.position.array[i3 + 2];
      this.baseParticlesTexture.image.data[i4 + 3] = Math.random();
    }
    // console.log(this.baseParticlesTexture.image.data);

    //Partcles Variables
    this.gpGpu.particleVariable = this.gpGpu.computation.addVariable(
      "uParticles",
      gpgpuParticlesShader,
      this.baseParticlesTexture
    );

    this.gpGpu.computation.setVariableDependencies(
      this.gpGpu.particleVariable,
      [this.gpGpu.particleVariable]
    );


    //Uniforms to prevent Loops in flowField
    this.gpGpu.particleVariable.material.uniforms.uTime = new THREE.Uniform(0)
    this.gpGpu.particleVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0)
    this.gpGpu.particleVariable.material.uniforms.uBase = new THREE.Uniform(this.baseParticlesTexture)




    //Init
    this.gpGpu.computation.init();
    this.gpGpu.debug.material.map =
      this.gpGpu.computation.getCurrentRenderTarget(
        this.gpGpu.particleVariable
      ).texture;

    //Final Geometry SphereGeometry to ==> BufferGeometry
    //particles
    this.particles = {
      geometry: new THREE.BufferGeometry(),
      material: this.material,
      points: null,
    };


    //create geometry without having attribute
    this.particles.geometry.setDrawRange(0, this.baseGeometry.count);

    //Mapping the points into GPGPU texture
    this.particlesUVArray = new Float32Array(this.baseGeometry.count * 2);
    this.sizeArray = new Float32Array(this.baseGeometry.count);

    for (let y = 0; y < this.gpGpu.size; y++) {
      for (let x = 0; x < this.gpGpu.size; x++) {
        const i = y * this.gpGpu.size + x;
        const i2 = i * 2;

        //  x / size to get 0 1 2 3 ...===> 0 to 1 with (1 excluded)
        // now the points are in center dot of 4 texture
        // to move this in top right square add 0.5

        const uvX = (x + 0.5) / this.gpGpu.size;
        const uvY = (y + 0.5) / this.gpGpu.size;

        this.particlesUVArray[i2 + 0] = uvX;
        this.particlesUVArray[i2 + 1] = uvY;

        this.sizeArray[i] = Math.random()

      }
    }

   
    this.particles.geometry.setAttribute("aParticlesUv",
      new THREE.BufferAttribute(this.particlesUVArray, 2));

    this.particles.geometry.setAttribute('aColor',
      this.baseGeometry.instance.attributes.color)

    this.particles.geometry.setAttribute('aSize',
      new THREE.BufferAttribute(this.sizeArray,1))

    this.particles.points = new THREE.Points(
      this.particles.geometry,
      this.material
    )


    this.scene.add(this.particles.points);

    //debugPlane
    this.gpGpu.debug.position.x = 3;
    // this.scene.add(this.gpGpu.debug);
  }

  settings() {
    let that = this;
    this.settings = {
      exposure: 2,
      bloomThreshold: 0.1,
      bloomStrength: 2,
      bloomRadius: 1.2,
    };
    this.gui = new dat.GUI();
    this.gui.add(this.settings, "exposure", 0, 3, 0.1).onChange(() => {
      that.renderer.toneMappingExposure = this.settings.exposure;
    });
  }

  setupResize() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    window.addEventListener("resize", this.resize.bind(this));
  }

  initiPost() {
    this.renderTarget = new THREE.WebGLRenderTarget(
      this.width,
      this.height,
      this.settings
    );

    this.renderScene = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5,
      0.4,
      0.85
    );
    this.bloomPass.threshold = this.settings.bloomThreshold;
    this.bloomPass.strength = this.settings.bloomStrength;
    this.bloomPass.radius = this.settings.bloomRadius;

    this.composer = new EffectComposer(this.renderer, this.renderTarget);
    this.composer.addPass(this.renderScene);
    this.composer.addPass(this.bloomPass);
  }

  resize() {
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }
  stop() {
    this.isPlaying = false;
  }
  play() {
    if (!this.isPlaying) {
      this.render();
      this.isPlaying = true;
    }
  }

  render() {
    this.elapsedTime = this.clock.getElapsedTime();
    this.deltaTime = this.elapsedTime - this.previousTime;
    this.previousTime = this.elapsedTime;
    // this.time = 0.05;

    requestAnimationFrame(this.render.bind(this));
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();

    if (!this.isPlaying) return;
    this.controls.update();

    this.stats.update();

    // this.material.uniforms.uTime.value += this.time;

    //for Bloom Enable this
    this.composer.render(this.scene, this.camera);

    //gpgpu
    if(this.gpGpu)
      {
        

      this.gpGpu.particleVariable.material.uniforms.uTime.value = this.elapsedTime  
      this.gpGpu.particleVariable.material.uniforms.uDeltaTime.value = this.deltaTime  
      this.gpGpu.computation.compute();
      
      this.material.uniforms.uParticlesTextures.value =
        this.gpGpu.computation.getCurrentRenderTarget(
          this.gpGpu.particleVariable
        ).texture;

        
      }
  }
}
